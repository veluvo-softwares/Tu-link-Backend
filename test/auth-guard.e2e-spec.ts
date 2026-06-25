import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { HttpExceptionFilter } from './../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from './../src/common/interceptors/response.interceptor';
import { LoggerService } from './../src/shared/logger/logger.service';
import { DatabaseService } from './../src/database/database.service';
import { RedisService } from './../src/shared/redis/redis.service';
import { FirebaseService } from './../src/shared/firebase/firebase.service';
import { UsersRepository } from './../src/database/repositories/users.repository';

// supertest types `res.body` as `any`; these shapes let assertions stay type-safe.
interface ErrorBody {
  error: { code: string };
}

// NOTE: This spec deliberately does NOT call .overrideGuard(FirebaseAuthGuard).
// The real, unmocked FirebaseAuthGuard runs against the real Nest HTTP pipeline
// (HttpExceptionFilter, ResponseInterceptor, ValidationPipe) for every request —
// that is the entire point of an end-to-end verification of AUTH-01..06.

// In-memory Redis stub backing both the guard's direct revocation-cache calls
// and AuthMetricsService's getClient().incr() counter write, so both call
// sites observe the same state.
function createRedisStateStub() {
  const map = new Map<string, string>();

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
    },
  };
}

// Infra stubs so the full AppModule boots without Postgres / Firebase creds —
// the auth-guard HTTP contract under test depends on neither.
const databaseServiceStub = {
  onModuleInit: () => Promise.resolve(),
  onModuleDestroy: () => Promise.resolve(),
};

const usersRepositoryStub = {
  search: jest.fn().mockResolvedValue([
    {
      uid: 'u1',
      email: 'a@example.com',
      displayName: 'Ada',
      phoneNumber: undefined,
    },
  ]),
};

describe('FirebaseAuthGuard (e2e)', () => {
  let app: INestApplication<App>;
  let redisState: ReturnType<typeof createRedisStateStub>;
  let firebaseServiceStub: {
    auth: { verifyIdToken: jest.Mock; getUser: jest.Mock };
  };

  beforeEach(async () => {
    redisState = createRedisStateStub();
    firebaseServiceStub = {
      auth: {
        verifyIdToken: jest.fn(),
        getUser: jest.fn(),
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
      .compile();

    app = moduleFixture.createNestApplication();

    // Mirror the production HTTP pipeline (main.ts): global filter, response
    // interceptor (wraps success bodies in { success, data }), and validation.
    const logger = app.get(LoggerService);
    app.useGlobalFilters(new HttpExceptionFilter(logger));
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );

    await app.init();
  });

  afterEach(async () => {
    redisState.map.clear();
    jest.clearAllMocks();
    await app.close();
  });

  // Decoded-token helper for verifyIdToken mock resolutions.
  const decodedToken = (uid: string, iatSeconds: number) => ({
    uid,
    email: `${uid}@example.com`,
    email_verified: true,
    iat: iatSeconds,
    firebase: { sign_in_provider: 'password' },
  });

  const nowSeconds = () => Math.floor(Date.now() / 1000);

  // --- AUTH-01: transient getUser() failures allow the request through ------

  it('AUTH-01: getUser() rejecting with app/network-error allows the request (200) and increments transient_bypass counter', async () => {
    const uid = 'auth01-network-error';
    firebaseServiceStub.auth.verifyIdToken.mockResolvedValue(
      decodedToken(uid, nowSeconds() - 100),
    );
    firebaseServiceStub.auth.getUser.mockRejectedValue({
      errorInfo: { code: 'app/network-error' },
    });

    const res = await request(app.getHttpServer())
      .get('/auth/searchUser?query=ab')
      .set('Authorization', 'Bearer faketoken');

    expect(res.status).toBe(200);
    expect(redisState.map.get('auth:metrics:transient_bypass:total')).toBe('1');
  });

  it('AUTH-01 variant: getUser() rejecting with app/network-timeout allows the request (200)', async () => {
    const uid = 'auth01-network-timeout';
    firebaseServiceStub.auth.verifyIdToken.mockResolvedValue(
      decodedToken(uid, nowSeconds() - 100),
    );
    firebaseServiceStub.auth.getUser.mockRejectedValue({
      errorInfo: { code: 'app/network-timeout' },
    });

    const res = await request(app.getHttpServer())
      .get('/auth/searchUser?query=ab')
      .set('Authorization', 'Bearer faketoken');

    expect(res.status).toBe(200);
  });

  it('AUTH-01 variant: getUser() rejecting with auth/internal-error allows the request (200)', async () => {
    const uid = 'auth01-internal-error';
    firebaseServiceStub.auth.verifyIdToken.mockResolvedValue(
      decodedToken(uid, nowSeconds() - 100),
    );
    firebaseServiceStub.auth.getUser.mockRejectedValue({
      errorInfo: { code: 'auth/internal-error' },
    });

    const res = await request(app.getHttpServer())
      .get('/auth/searchUser?query=ab')
      .set('Authorization', 'Bearer faketoken');

    expect(res.status).toBe(200);
  });

  // --- AUTH-02: unchanged TOKEN_EXPIRED / TOKEN_REVOKED semantics ------------

  it('AUTH-02: verifyIdToken rejecting with auth/id-token-expired returns 401 TOKEN_EXPIRED without calling getUser', async () => {
    firebaseServiceStub.auth.verifyIdToken.mockRejectedValue({
      errorInfo: { code: 'auth/id-token-expired' },
    });

    const res = await request(app.getHttpServer())
      .get('/auth/searchUser?query=ab')
      .set('Authorization', 'Bearer faketoken');

    expect(res.status).toBe(401);
    expect((res.body as ErrorBody).error.code).toBe('TOKEN_EXPIRED');
    expect(firebaseServiceStub.auth.getUser).not.toHaveBeenCalled();
  });

  it('AUTH-02 variant (TOKEN_REVOKED): tokensValidAfterTime after iat returns 401 TOKEN_REVOKED', async () => {
    const uid = 'auth02-revoked';
    const iat = nowSeconds() - 1000;
    firebaseServiceStub.auth.verifyIdToken.mockResolvedValue(
      decodedToken(uid, iat),
    );
    firebaseServiceStub.auth.getUser.mockResolvedValue({
      tokensValidAfterTime: new Date((iat + 500) * 1000).toISOString(),
    });

    const res = await request(app.getHttpServer())
      .get('/auth/searchUser?query=ab')
      .set('Authorization', 'Bearer faketoken');

    expect(res.status).toBe(401);
    expect((res.body as ErrorBody).error.code).toBe('TOKEN_REVOKED');
  });

  // --- AUTH-03: fail-closed on auth/user-not-found (D-04) --------------------

  it('AUTH-03: getUser() rejecting with auth/user-not-found returns 401 AUTH_FAILED (fail closed, not allowed)', async () => {
    const uid = 'auth03-user-not-found';
    firebaseServiceStub.auth.verifyIdToken.mockResolvedValue(
      decodedToken(uid, nowSeconds() - 100),
    );
    firebaseServiceStub.auth.getUser.mockRejectedValue({
      errorInfo: { code: 'auth/user-not-found' },
    });

    const res = await request(app.getHttpServer())
      .get('/auth/searchUser?query=ab')
      .set('Authorization', 'Bearer faketoken');

    expect(res.status).toBe(401);
    expect((res.body as ErrorBody).error.code).toBe('AUTH_FAILED');
    expect(
      redisState.map.get('auth:metrics:transient_bypass:total'),
    ).toBeUndefined();
  });

  // --- AUTH-04: revocation cache suppresses repeated getUser() calls --------

  it('AUTH-04: 3 sequential requests for the same uid trigger getUser() at most once within the cache TTL window', async () => {
    const uid = 'auth04-cache-hit';
    const iat = nowSeconds() - 100;
    firebaseServiceStub.auth.verifyIdToken.mockResolvedValue(
      decodedToken(uid, iat),
    );
    firebaseServiceStub.auth.getUser.mockResolvedValue({
      tokensValidAfterTime: new Date((iat - 1000) * 1000).toISOString(),
    });

    for (let i = 0; i < 3; i++) {
      const res = await request(app.getHttpServer())
        .get('/auth/searchUser?query=ab')
        .set('Authorization', 'Bearer faketoken');
      expect(res.status).toBe(200);
    }

    expect(firebaseServiceStub.auth.getUser.mock.calls.length).toBe(1);
  });

  // --- AUTH-05: cache invalidation forces a live re-check --------------------

  it('AUTH-05: invalidateRevocationCache forces the next request to call getUser() again instead of reading a stale cache entry', async () => {
    const uid = 'auth05-cache-invalidate';
    const iat = nowSeconds() - 100;
    firebaseServiceStub.auth.verifyIdToken.mockResolvedValue(
      decodedToken(uid, iat),
    );
    firebaseServiceStub.auth.getUser.mockResolvedValue({
      tokensValidAfterTime: new Date((iat - 1000) * 1000).toISOString(),
    });

    // First request populates the cache.
    const first = await request(app.getHttpServer())
      .get('/auth/searchUser?query=ab')
      .set('Authorization', 'Bearer faketoken');
    expect(first.status).toBe(200);
    expect(firebaseServiceStub.auth.getUser.mock.calls.length).toBe(1);

    // Simulate AuthService.logout()'s write-through DEL.
    await redisState.redisServiceStub.invalidateRevocationCache(uid);

    // Second request must hit getUser() again — the cache was busted.
    const second = await request(app.getHttpServer())
      .get('/auth/searchUser?query=ab')
      .set('Authorization', 'Bearer faketoken');
    expect(second.status).toBe(200);
    expect(firebaseServiceStub.auth.getUser.mock.calls.length).toBe(2);
  });

  // --- AUTH-06: transient_bypass counter increments exactly once per event --

  it('AUTH-06: the transient_bypass counter increments by exactly 1 per transient-bypass event', async () => {
    const uid = 'auth06-metric-once';
    firebaseServiceStub.auth.verifyIdToken.mockResolvedValue(
      decodedToken(uid, nowSeconds() - 100),
    );
    firebaseServiceStub.auth.getUser.mockRejectedValue({
      errorInfo: { code: 'app/network-error' },
    });

    const before = parseInt(
      redisState.map.get('auth:metrics:transient_bypass:total') ?? '0',
      10,
    );

    const res = await request(app.getHttpServer())
      .get('/auth/searchUser?query=ab')
      .set('Authorization', 'Bearer faketoken');

    expect(res.status).toBe(200);

    const after = parseInt(
      redisState.map.get('auth:metrics:transient_bypass:total') ?? '0',
      10,
    );

    expect(after - before).toBe(1);
  });
});
