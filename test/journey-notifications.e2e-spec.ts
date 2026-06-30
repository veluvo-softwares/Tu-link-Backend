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
});
