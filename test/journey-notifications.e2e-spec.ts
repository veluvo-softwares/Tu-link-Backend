import { Test, TestingModule } from '@nestjs/testing';
import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { and, eq, sql } from 'drizzle-orm';
import { AppModule } from './../src/app.module';
import { FirebaseAuthGuard } from './../src/common/guards/firebase-auth.guard';
import { FirebaseService } from './../src/shared/firebase/firebase.service';
import { FcmService } from './../src/modules/notification/services/fcm.service';
import { HttpExceptionFilter } from './../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from './../src/common/interceptors/response.interceptor';
import { LoggerService } from './../src/shared/logger/logger.service';
import { UsersRepository } from './../src/database/repositories/users.repository';
import { DatabaseService } from './../src/database/database.service';
import { notifications } from './../src/database/schema/notifications';

// NOTE: FirebaseService and FcmService are stubbed. All other production code
// (NotificationService, JourneyService, ParticipantService, DatabaseService,
// RedisService) runs against the real local Postgres + Redis docker-compose.
// This validates the full notification wiring end-to-end.

interface MockAuthRequest {
  user?: { uid: string };
  headers: Record<string, string | string[] | undefined>;
}

interface SuccessBody<T> {
  data: T;
}

interface JourneyData {
  id: string;
  status: string;
  leaderId: string;
}

// Per-request header that the mock auth guard reads to determine the acting uid.
// Using a header (not a shared variable) eliminates cross-request identity
// hazard when concurrent requests are in flight.
const TEST_UID_HEADER = 'x-test-uid';

const firebaseServiceStub = {
  onModuleInit: () => undefined,
  getAuth: () => ({}),
  getMessaging: () => ({}),
};

describe('Journey Notifications (e2e) -- Phase 05', () => {
  let app: INestApplication<App>;
  let usersRepository: UsersRepository;
  let databaseService: DatabaseService;
  let fcmServiceMock: { sendToUser: jest.Mock };

  // Unique per-run token so reruns never collide with prior run rows (WR-03).
  const runToken = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const uidFor = (label: string): string => `${runToken}-${label}`;

  /**
   * Poll an assertion until it passes or the timeout elapses. Used instead of
   * fixed sleeps when awaiting fire-and-forget work (e.g. the setup
   * confirmation push), which is timing-dependent under CI load.
   */
  const waitFor = async (
    assertion: () => void,
    { timeout = 2000, interval = 50 } = {},
  ): Promise<void> => {
    const start = Date.now();
    for (;;) {
      try {
        assertion();
        return;
      } catch (err) {
        if (Date.now() - start > timeout) throw err;
        await new Promise((r) => setTimeout(r, interval));
      }
    }
  };

  const createdUserIds: string[] = [];
  const leaderUserIds: string[] = [];

  beforeAll(async () => {
    const mockFcm = {
      sendToUser: jest
        .fn()
        .mockResolvedValue({ success: true, sentCount: 0, failedTokens: [] }),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(FirebaseAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest<MockAuthRequest>();
          const headerUid = req.headers[TEST_UID_HEADER];
          const uid = Array.isArray(headerUid) ? headerUid[0] : headerUid;
          req.user = { uid: uid ?? 'unset' };
          return true;
        },
      })
      .overrideProvider(FirebaseService)
      .useValue(firebaseServiceStub)
      .overrideProvider(FcmService)
      .useValue(mockFcm)
      .compile();

    app = moduleFixture.createNestApplication();

    // Mirror the production HTTP pipeline (main.ts) exactly.
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

    usersRepository = app.get(UsersRepository);
    databaseService = app.get(DatabaseService);
    // Retrieve the injected mock so tests can inspect calls.
    fcmServiceMock = app.get(FcmService);
  });

  beforeEach(() => {
    // Isolate FcmService call counts between tests.
    fcmServiceMock.sendToUser.mockClear();
  });

  afterAll(async () => {
    // Delete journeys for each leader first (ON DELETE CASCADE removes
    // participants and notifications). Then delete the user rows.
    for (const uid of leaderUserIds) {
      try {
        await databaseService.db.execute(
          sql`DELETE FROM journeys WHERE leader_id = ${uid}`,
        );
      } catch {
        // Non-fatal — unique per-run uids avoid cross-run collisions.
      }
    }
    for (const uid of createdUserIds) {
      try {
        await databaseService.db.execute(
          sql`DELETE FROM fcm_tokens WHERE user_id = ${uid}`,
        );
        await databaseService.db.execute(
          sql`DELETE FROM users WHERE id = ${uid}`,
        );
      } catch {
        // Non-fatal.
      }
    }
    await app.close();
  });

  // ─── Shared helpers ────────────────────────────────────────────────────────

  async function seedUser(
    uid: string,
    displayName: string,
    isLeader = false,
  ): Promise<void> {
    createdUserIds.push(uid);
    if (isLeader) leaderUserIds.push(uid);
    const existing = await usersRepository.findById(uid);
    if (!existing) {
      await usersRepository.create({
        id: uid,
        email: `${uid}@test.example.com`,
        displayName,
      });
    }
  }

  async function createJourney(
    leaderUid: string,
    name: string,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/journeys')
      .set(TEST_UID_HEADER, leaderUid)
      .send({ name });
    expect(res.status).toBe(201);
    return (res.body as SuccessBody<JourneyData>).data.id;
  }

  async function inviteParticipant(
    leaderUid: string,
    journeyId: string,
    invitedUserId: string,
  ): Promise<void> {
    const res = await request(app.getHttpServer())
      .post(`/journeys/${journeyId}/invite`)
      .set(TEST_UID_HEADER, leaderUid)
      .send({ invitedUserId });
    expect(res.status).toBe(201);
  }

  async function acceptInvitation(
    userId: string,
    journeyId: string,
  ): Promise<void> {
    const res = await request(app.getHttpServer())
      .post(`/journeys/${journeyId}/accept`)
      .set(TEST_UID_HEADER, userId);
    expect(res.status).toBe(200);
  }

  async function startJourney(
    leaderUid: string,
    journeyId: string,
  ): Promise<void> {
    const res = await request(app.getHttpServer())
      .post(`/journeys/${journeyId}/start`)
      .set(TEST_UID_HEADER, leaderUid);
    expect(res.status).toBe(201);
  }

  // ─── NOTIF-07: PARTICIPANT_LEFT ────────────────────────────────────────────

  describe('NOTIF-07: PARTICIPANT_LEFT on leave', () => {
    it('creates PARTICIPANT_LEFT rows for remaining participants but zero rows for the leaver', async () => {
      const leaderId = uidFor('notif07-leader');
      const memberId = uidFor('notif07-member');

      await seedUser(leaderId, 'N7 Leader', /* isLeader */ true);
      await seedUser(memberId, 'N7 Member');

      const journeyId = await createJourney(leaderId, 'NOTIF-07 Test Journey');

      // Invite member → accept (ACCEPTED) → start (both become ACTIVE)
      await inviteParticipant(leaderId, journeyId, memberId);
      await acceptInvitation(memberId, journeyId);
      await startJourney(leaderId, journeyId);

      // Reset accumulated setup FCM calls to isolate the leave action.
      fcmServiceMock.sendToUser.mockClear();

      // Member leaves the active journey
      const leaveRes = await request(app.getHttpServer())
        .post(`/journeys/${journeyId}/leave`)
        .set(TEST_UID_HEADER, memberId);

      expect(leaveRes.status).toBe(200);

      // DB assertions — PARTICIPANT_LEFT rows (T-05-09: actor-exclusion enforced)
      const notifRows = await databaseService.db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.journeyId, journeyId),
            eq(notifications.type, 'PARTICIPANT_LEFT'),
          ),
        );

      const leaderRow = notifRows.find((r) => r.recipientId === leaderId);
      const leaverRow = notifRows.find((r) => r.recipientId === memberId);

      expect(leaderRow).toBeDefined(); // leader must be notified
      expect(leaderRow?.type).toBe('PARTICIPANT_LEFT');
      expect(leaverRow).toBeUndefined(); // D-01: actor must NOT receive their own action
    });
  });

  // ─── NOTIF-09: PARTICIPANT_JOINED ──────────────────────────────────────────

  describe('NOTIF-09: PARTICIPANT_JOINED on accept', () => {
    it('creates PARTICIPANT_JOINED rows for existing members but zero rows for the joiner', async () => {
      const leaderId = uidFor('notif09-leader');
      const existingMemberId = uidFor('notif09-member');
      const invitedUserId = uidFor('notif09-invited');

      await seedUser(leaderId, 'N9 Leader', /* isLeader */ true);
      await seedUser(existingMemberId, 'N9 Member');
      await seedUser(invitedUserId, 'N9 Invited');

      const journeyId = await createJourney(leaderId, 'NOTIF-09 Test Journey');

      // Invite existing_member and accept while journey is PENDING.
      await inviteParticipant(leaderId, journeyId, existingMemberId);
      await acceptInvitation(existingMemberId, journeyId);

      // Invite invited_user before start (invite only works on PENDING journeys).
      await inviteParticipant(leaderId, journeyId, invitedUserId);

      // Start journey: existing_member → ACTIVE; invited_user stays INVITED.
      await startJourney(leaderId, journeyId);

      // Reset accumulated setup FCM calls.
      fcmServiceMock.sendToUser.mockClear();

      // invited_user accepts the already-ACTIVE journey.
      // acceptInvitation() detects ACTIVE status and calls markActive() directly,
      // then fires sendParticipantJoined for leader + existing_member (D-01/D-12).
      const acceptRes = await request(app.getHttpServer())
        .post(`/journeys/${journeyId}/accept`)
        .set(TEST_UID_HEADER, invitedUserId);

      expect(acceptRes.status).toBe(200);

      // DB assertions — PARTICIPANT_JOINED rows (T-05-10: actor-exclusion enforced)
      const notifRows = await databaseService.db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.journeyId, journeyId),
            eq(notifications.type, 'PARTICIPANT_JOINED'),
          ),
        );

      const leaderRow = notifRows.find((r) => r.recipientId === leaderId);
      const memberRow = notifRows.find(
        (r) => r.recipientId === existingMemberId,
      );
      const joinerRow = notifRows.find((r) => r.recipientId === invitedUserId);

      expect(leaderRow).toBeDefined(); // leader gets notified
      expect(leaderRow?.type).toBe('PARTICIPANT_JOINED');
      expect(memberRow).toBeDefined(); // existing active member gets notified
      expect(memberRow?.type).toBe('PARTICIPANT_JOINED');
      expect(joinerRow).toBeUndefined(); // D-01: joiner must NOT receive their own join
    });
  });

  // ─── NOTIF-01: setup-confirmation push ─────────────────────────────────────

  describe('NOTIF-01: setup-confirmation push on first FCM token registration', () => {
    it('calls FcmService.sendToUser with SETUP_CONFIRMATION and creates zero notifications rows', async () => {
      const userId = uidFor('notif01-user');
      await seedUser(userId, 'N1 User');

      // POST /notifications/fcm-token for a user with NO existing tokens.
      // registerFcmToken() fires sendSetupConfirmationPush() as fire-and-forget
      // after detecting the 0→1 token transition.
      const tokenRes = await request(app.getHttpServer())
        .post('/notifications/fcm-token')
        .set(TEST_UID_HEADER, userId)
        .send({ fcmToken: `test-device-token-${userId}` });

      expect(tokenRes.status).toBe(201);

      // The fire-and-forget sendSetupConfirmationPush calls fcmTokenRepository
      // .getTokens() (real DB) then fcmService.sendToUser (mocked). Poll until
      // the DB round-trip completes rather than relying on a fixed sleep.
      // FCM assertion: sendToUser must have been called with SETUP_CONFIRMATION
      // (T-05-11: correct userId, single call, data.type verified).
      await waitFor(() =>
        expect(fcmServiceMock.sendToUser).toHaveBeenCalledWith(
          expect.any(Array),
          expect.objectContaining({
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            data: expect.objectContaining({ type: 'SETUP_CONFIRMATION' }),
          }),
        ),
      );

      // DB assertion: NEVER write a notifications table row for setup-confirmation
      // (D-05/D-06: no journey context for this push type).
      const notifCount = await databaseService.db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientId, userId));

      expect(notifCount).toHaveLength(0);
    });
  });

  // ─── NOTIF-02: permission-status endpoint ──────────────────────────────────

  describe('NOTIF-02: GET /notifications/permission-status returns 200', () => {
    it('is reachable and returns HTTP 200 for an authenticated user', async () => {
      const userId = uidFor('notif02-user');
      await seedUser(userId, 'N2 User');

      const res = await request(app.getHttpServer())
        .get('/notifications/permission-status')
        .set(TEST_UID_HEADER, userId);

      expect(res.status).toBe(200);
    });
  });

  // ─── NOTIF-03/04/05: data envelope — type key present ──────────────────────

  describe('NOTIF-03/04/05: FCM data envelope carries type key for JOURNEY_INVITE, JOURNEY_STARTED, JOURNEY_ENDED', () => {
    it('each push action includes data.type in the FCM payload', async () => {
      const leaderId = uidFor('env-leader');
      const memberId = uidFor('env-member');
      const inviteeId = uidFor('env-invitee');

      await seedUser(leaderId, 'Env Leader', /* isLeader */ true);
      await seedUser(memberId, 'Env Member');
      await seedUser(inviteeId, 'Env Invitee');

      const journeyId = await createJourney(leaderId, 'Envelope Test Journey');

      // Invite and accept existing_member so there is at least one recipient for
      // JOURNEY_STARTED and JOURNEY_ENDED notifications.
      await inviteParticipant(leaderId, journeyId, memberId);
      await acceptInvitation(memberId, journeyId);

      // ── Action B (NOTIF-03 — JOURNEY_INVITE) ───────────────────────────────
      // Invite must happen before start (journey must be PENDING).
      // Deviation from plan action order (A/B/C → B/A/C): the plan listed
      // JOURNEY_STARTED as action A and JOURNEY_INVITE as B, but invite requires
      // a PENDING journey — Rule 1 auto-fix: reorder to match the API constraint.
      fcmServiceMock.sendToUser.mockClear();

      await inviteParticipant(leaderId, journeyId, inviteeId);

      expect(fcmServiceMock.sendToUser).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: expect.objectContaining({ type: 'JOURNEY_INVITE' }),
        }),
      );

      // ── Action A (NOTIF-04 — JOURNEY_STARTED) ──────────────────────────────
      fcmServiceMock.sendToUser.mockClear();

      await startJourney(leaderId, journeyId);

      expect(fcmServiceMock.sendToUser).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: expect.objectContaining({ type: 'JOURNEY_STARTED' }),
        }),
      );

      // ── Action C (NOTIF-05 — JOURNEY_ENDED) ────────────────────────────────
      fcmServiceMock.sendToUser.mockClear();

      const endRes = await request(app.getHttpServer())
        .post(`/journeys/${journeyId}/end`)
        .set(TEST_UID_HEADER, leaderId);

      expect(endRes.status).toBe(201);

      expect(fcmServiceMock.sendToUser).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: expect.objectContaining({ type: 'JOURNEY_ENDED' }),
        }),
      );
    });
  });
});
