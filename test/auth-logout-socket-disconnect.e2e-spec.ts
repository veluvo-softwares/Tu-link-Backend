import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import type { Server } from 'http';
import request from 'supertest';
import { App } from 'supertest/types';
import { io, Socket as ClientSocket } from 'socket.io-client';
import { AppModule } from './../src/app.module';
import { DatabaseService } from './../src/database/database.service';
import { RedisService } from './../src/shared/redis/redis.service';
import { FirebaseService } from './../src/shared/firebase/firebase.service';
import { UsersRepository } from './../src/database/repositories/users.repository';
import { ParticipantService } from './../src/modules/journey/services/participant.service';

// NOTE: This spec deliberately does NOT override AuthService, LocationGateway,
// or EventEmitterModule. Those three must be the real, production classes so
// this test proves the actual runtime wiring of the auth.logout event bus
// (AuthService emits -> EventEmitter2 -> LocationGateway @OnEvent listener ->
// disconnectSockets), not a mocked approximation of it. Only unrelated infra
// (Firebase, Postgres, Redis, ParticipantService's DB-backed membership check)
// is stubbed, following the test/auth-guard.e2e-spec.ts precedent.

// In-memory Redis stub covering every RedisService method touched by the
// LocationGateway connect/join/disconnect/logout paths exercised below.
function createRedisStateStub() {
  const map = new Map<string, string>();
  const sets = new Map<string, Set<string>>();

  const client = {
    get: (key: string) => Promise.resolve(map.get(key) ?? null),
    setex: (key: string, _ttl: number, value: string) => {
      map.set(key, value);
      return Promise.resolve('OK');
    },
    del: (key: string) => {
      const existed = map.delete(key);
      return Promise.resolve(existed ? 1 : 0);
    },
    incr: (key: string) => {
      const current = parseInt(map.get(key) ?? '0', 10);
      const next = current + 1;
      map.set(key, String(next));
      return Promise.resolve(next);
    },
    incrby: (key: string, amount: number) => {
      const current = parseInt(map.get(key) ?? '0', 10);
      const next = current + amount;
      map.set(key, String(next));
      return Promise.resolve(next);
    },
  };

  return {
    map,
    redisServiceStub: {
      getClient: () => client,
      getCachedRevocation: (uid: string): Promise<string | null> =>
        Promise.resolve(map.get(`auth:revocation:${uid}`) ?? null),
      setCachedRevocation: (
        uid: string,
        tokensValidAfterTime: string,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        ttlSeconds: number,
      ): Promise<void> => {
        map.set(`auth:revocation:${uid}`, tokensValidAfterTime);
        return Promise.resolve();
      },
      invalidateRevocationCache: (uid: string): Promise<void> => {
        map.delete(`auth:revocation:${uid}`);
        return Promise.resolve();
      },
      setSocketUser: (socketId: string, userId: string): Promise<void> => {
        map.set(`socket:user:${socketId}`, userId);
        return Promise.resolve();
      },
      getSocketUser: (socketId: string): Promise<string | null> =>
        Promise.resolve(map.get(`socket:user:${socketId}`) ?? null),
      deleteSocketUser: (socketId: string): Promise<void> => {
        map.delete(`socket:user:${socketId}`);
        return Promise.resolve();
      },
      setConnectionStatus: (
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        participantId: string,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        isConnected: boolean,
      ): Promise<void> => Promise.resolve(),
      addSocketToRoom: (journeyId: string, socketId: string): Promise<void> => {
        const key = `room:${journeyId}`;
        const set = sets.get(key) ?? new Set<string>();
        set.add(socketId);
        sets.set(key, set);
        return Promise.resolve();
      },
      removeSocketFromRoom: (
        journeyId: string,
        socketId: string,
      ): Promise<void> => {
        sets.get(`room:${journeyId}`)?.delete(socketId);
        return Promise.resolve();
      },
      addJourneyParticipant: (
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        journeyId: string,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        userId: string,
      ): Promise<void> => Promise.resolve(),
    },
  };
}

const databaseServiceStub = {
  onModuleInit: () => Promise.resolve(),
  onModuleDestroy: () => Promise.resolve(),
};

const usersRepositoryStub = {
  setLastLogout: jest.fn().mockResolvedValue(undefined),
};

const participantServiceStub = {
  isParticipant: jest.fn().mockResolvedValue(true),
  updateConnectionStatus: jest.fn().mockResolvedValue(undefined),
};

describe('auth.logout -> LocationGateway force-disconnect (e2e)', () => {
  let app: INestApplication<App>;
  let redisState: ReturnType<typeof createRedisStateStub>;
  let firebaseServiceStub: {
    auth: {
      verifyIdToken: jest.Mock;
      getUser: jest.Mock;
      deleteUser: jest.Mock;
      revokeRefreshTokens: jest.Mock;
    };
  };
  let baseUrl: string;
  const clients: ClientSocket[] = [];

  // Token-string -> uid lookup so each client connection (and each HTTP
  // logout call) can authenticate as a distinct, test-controlled uid without
  // sequencing brittle mockResolvedValueOnce calls.
  const tokenToUid = new Map<string, string>();

  // All sessions authenticate via a standard provider; AuthService.logout()
  // always takes the revoke + emit path (guest sign-in has been removed).
  const decodedToken = (uid: string) => ({
    uid,
    email: `${uid}@example.com`,
    email_verified: true,
    iat: Math.floor(Date.now() / 1000) - 100,
    firebase: {
      sign_in_provider: 'password',
    },
  });

  beforeEach(async () => {
    redisState = createRedisStateStub();
    tokenToUid.clear();
    jest.clearAllMocks();

    firebaseServiceStub = {
      auth: {
        verifyIdToken: jest.fn((token: string) => {
          const uid = tokenToUid.get(token);
          if (!uid) {
            return Promise.reject(new Error('unknown test token'));
          }
          return Promise.resolve(decodedToken(uid));
        }),
        // No revocation timestamp -- the auth guard's getUser() check (used
        // only by the /auth/logout route's own FirebaseAuthGuard pass before
        // AuthService.logout() runs) resolves with nothing revoked.
        getUser: jest
          .fn()
          .mockResolvedValue({ tokensValidAfterTime: undefined }),
        deleteUser: jest.fn().mockResolvedValue(undefined),
        revokeRefreshTokens: jest.fn().mockResolvedValue(undefined),
      },
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(FirebaseService)
      .useValue(firebaseServiceStub)
      .overrideProvider(RedisService)
      .useValue(redisState.redisServiceStub)
      .overrideProvider(DatabaseService)
      .useValue(databaseServiceStub)
      .overrideProvider(UsersRepository)
      .useValue(usersRepositoryStub)
      .overrideProvider(ParticipantService)
      .useValue(participantServiceStub)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    await app.listen(0);

    const httpServer = app.getHttpServer() as Server;
    const address = httpServer.address();
    const port =
      typeof address === 'string' || address === null ? 0 : address.port;
    baseUrl = `http://localhost:${port}`;
  });

  afterEach(async () => {
    for (const client of clients) {
      client.removeAllListeners();
      client.disconnect();
    }
    clients.length = 0;
    redisState.map.clear();
    jest.clearAllMocks();
    await app.close();
  });

  // Connects a real socket.io-client to the /location namespace, registers
  // the given uid behind the given bearer token, and waits for the server's
  // 'connection-status: CONNECTED' acknowledgment before resolving.
  function connectAsUser(uid: string): Promise<ClientSocket> {
    const token = `token-${uid}`;
    tokenToUid.set(token, uid);

    return new Promise((resolve, reject) => {
      const client = io(`${baseUrl}/location`, {
        transports: ['websocket'],
        auth: { token },
        forceNew: true,
      });
      clients.push(client);

      const timer = setTimeout(() => {
        reject(new Error(`connectAsUser(${uid}) timed out waiting to connect`));
      }, 5000);

      client.on('connection-status', (payload: { status: string }) => {
        if (payload.status === 'CONNECTED') {
          clearTimeout(timer);
          resolve(client);
        }
      });

      client.on('connect_error', (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  function waitForDisconnect(
    client: ClientSocket,
    timeoutMs = 5000,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!client.connected) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        reject(new Error('timed out waiting for client disconnect event'));
      }, timeoutMs);
      client.once('disconnect', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  function waitForEvent<T>(
    client: ClientSocket,
    event: string,
    timeoutMs = 5000,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`timed out waiting for '${event}' event`));
      }, timeoutMs);
      client.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  }

  function joinJourney(client: ClientSocket, journeyId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('timed out waiting to join journey'));
      }, 5000);
      client.once('joined-journey', () => {
        clearTimeout(timer);
        resolve();
      });
      client.once('error', (err: { message: string }) => {
        clearTimeout(timer);
        reject(new Error(err.message));
      });
      client.emit('join-journey', { journeyId });
    });
  }

  async function logout(uid: string): Promise<request.Response> {
    const token = `token-${uid}`;
    tokenToUid.set(token, uid);
    return request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${token}`);
  }

  // --- SOCK-01 + SOCK-04: room-scoped disconnect via the real event bus ---

  it("SOCK-01/04: logout force-disconnects the logged-out user's socket via the unmocked AuthService -> EventEmitter2 -> LocationGateway chain", async () => {
    const uidA = 'sock01-uidA';
    const clientA = await connectAsUser(uidA);
    expect(clientA.connected).toBe(true);

    const disconnected = waitForDisconnect(clientA);
    const res = await logout(uidA);

    expect(res.status).toBe(200);
    await disconnected;
    expect(clientA.connected).toBe(false);
  });

  // --- SOCK-03: scope isolation -- a different user's socket is untouched ---

  it("SOCK-03: a different user's socket stays connected when another user logs out", async () => {
    const uidA = 'sock03-uidA';
    const uidB = 'sock03-uidB';
    const clientA = await connectAsUser(uidA);
    const clientB = await connectAsUser(uidB);

    // Bind the negative assertion to an actual disconnect event on B rather
    // than only a fixed-delay connected-state snapshot, so the test cannot
    // pass coincidentally just because nothing happened within the window.
    let bDisconnected = false;
    clientB.once('disconnect', () => {
      bDisconnected = true;
    });

    const disconnectedA = waitForDisconnect(clientA);
    const res = await logout(uidA);
    expect(res.status).toBe(200);
    await disconnectedA;

    expect(clientA.connected).toBe(false);
    // Give the room-scoped disconnect a moment to (not) propagate to B's
    // room. By this point A has demonstrably disconnected, so the wait is
    // bounded by something that already happened, not an arbitrary guess.
    await new Promise((r) => setTimeout(r, 300));
    expect(bDisconnected).toBe(false);
    expect(clientB.connected).toBe(true);
  });

  // --- SOCK-02: peer notification via the existing handleDisconnect flow ---

  it('SOCK-02: a peer in the same journey room receives participant-disconnected after the forced disconnect', async () => {
    const uidA = 'sock02-uidA';
    const uidB = 'sock02-uidB';
    const journeyId = 'journey-sock02';

    const clientA = await connectAsUser(uidA);
    const clientB = await connectAsUser(uidB);

    await joinJourney(clientA, journeyId);
    await joinJourney(clientB, journeyId);

    const participantDisconnected = waitForEvent<{
      userId: string;
      timestamp: number;
    }>(clientB, 'participant-disconnected');

    const res = await logout(uidA);
    expect(res.status).toBe(200);

    const payload = await participantDisconnected;
    expect(payload.userId).toBe(uidA);
  });

  // --- Regression: logout with zero live sockets is a harmless no-op ---

  it('regression: logging out a user with no live sockets does not throw and still returns 200', async () => {
    const uid = 'sock-no-sockets';
    const token = `token-${uid}`;
    tokenToUid.set(token, uid);

    const res = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    // logout() revokes refresh tokens then emits auth.logout; with zero live
    // sockets in the user:{uid} room, the gateway's disconnectSockets(true)
    // call is a harmless no-op.
    expect(firebaseServiceStub.auth.revokeRefreshTokens).toHaveBeenCalledWith(
      uid,
    );
  });
});
