import { Test, TestingModule } from '@nestjs/testing';
import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { sql } from 'drizzle-orm';
import { AppModule } from './../src/app.module';
import { FirebaseAuthGuard } from './../src/common/guards/firebase-auth.guard';
import { FirebaseService } from './../src/shared/firebase/firebase.service';
import { HttpExceptionFilter } from './../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from './../src/common/interceptors/response.interceptor';
import { LoggerService } from './../src/shared/logger/logger.service';
import { UsersRepository } from './../src/database/repositories/users.repository';
import { JourneyRepository } from './../src/database/repositories/journey.repository';
import { DatabaseService } from './../src/database/database.service';

// NOTE: This spec deliberately does NOT override DatabaseService or
// RedisService. Both must be the real, production classes pointed at the
// local dev Postgres/Redis (docker-compose) -- JRNY-03's concurrency
// assertion only proves anything if the requests actually race against the
// real `idx_journeys_one_active_per_leader` partial unique index from Plan 01
// and the real `db.transaction()` + 23505 catch from Plan 02. Only
// FirebaseAuthGuard (to inject a controllable uid) and FirebaseService (no
// real Firebase creds needed, FcmService already try/catches around it) are
// stubbed, following the precedent in maps.e2e-spec.ts / auth-guard.e2e-spec.ts.

interface MockAuthRequest {
  user?: { uid: string };
  headers: Record<string, string | string[] | undefined>;
}

interface ErrorBody {
  error: { code: string; activeJourneyId?: string };
}
interface JourneyData {
  id: string;
  status: string;
  leaderId: string;
}
interface SuccessBody<T> {
  data: T;
}

const firebaseServiceStub = {
  onModuleInit: () => undefined,
  getAuth: () => ({}),
  getMessaging: () => ({}),
};

// Test-only header the mock auth guard below reads to determine the acting
// uid for each request. Using an explicit per-request header (rather than a
// shared module-level mutable variable) removes any cross-request identity
// hazard when multiple requests are in flight concurrently (WR-04) -- each
// request carries its own identity independent of request ordering.
const TEST_UID_HEADER = 'x-test-uid';

describe('Journey start (e2e) -- JRNY-01..04', () => {
  let app: INestApplication<App>;
  let usersRepository: UsersRepository;
  let journeyRepository: JourneyRepository;
  let databaseService: DatabaseService;

  // Suffix every seeded uid with a per-run token so reruns never collide
  // with rows left behind by a previous run (WR-03). A stray leftover ACTIVE
  // journey from a prior run colliding with a fixed uid was previously able
  // to poison JRNY-02's "no active journey -> succeeds" assertion.
  const runToken = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const uidFor = (label: string): string => `${label}-${runToken}`;

  const createdUserIds: string[] = [];

  beforeAll(async () => {
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
      .compile();

    app = moduleFixture.createNestApplication();

    // Mirror the production HTTP pipeline (main.ts) exactly so the 409 body
    // assertions reflect what a real client actually receives.
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
    journeyRepository = app.get(JourneyRepository);
    databaseService = app.get(DatabaseService);
  });

  afterAll(async () => {
    // Best-effort cleanup so reruns don't accumulate rows. uids are unique
    // per run (runToken suffix), but still delete unconditionally for every
    // uid this run seeded -- regardless of whether seedLeader actually
    // inserted the row this run -- rather than relying on createdUserIds
    // tracking alone, so a partially-seeded run never leaves an ACTIVE
    // journey behind to poison a future run. Parameterized via sql to avoid
    // the raw string-interpolation pattern.
    for (const uid of createdUserIds) {
      try {
        await databaseService.db.execute(
          sql`DELETE FROM journeys WHERE leader_id = ${uid}`,
        );
        await databaseService.db.execute(
          sql`DELETE FROM users WHERE id = ${uid}`,
        );
      } catch {
        // Non-fatal -- harmless to leave test rows in the local dev DB if
        // cleanup fails; unique per-run uids avoid cross-run collisions.
      }
    }
    await app.close();
  });

  async function seedLeader(uid: string): Promise<void> {
    // Track every uid this run intends to use BEFORE checking existence, so
    // afterAll always attempts cleanup for it even if seeding is skipped
    // (e.g. a retried test run hitting an already-existing row) or fails
    // partway through.
    createdUserIds.push(uid);
    const existing = await usersRepository.findById(uid);
    if (!existing) {
      await usersRepository.create({
        id: uid,
        email: `${uid}@example.com`,
        displayName: uid,
      });
    }
  }

  async function createJourney(uid: string, name: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/journeys')
      .set(TEST_UID_HEADER, uid)
      .send({ name });
    expect(res.status).toBe(201);
    return (res.body as SuccessBody<JourneyData>).data.id;
  }

  async function startJourney(
    uid: string,
    journeyId: string,
  ): Promise<request.Response> {
    return request(app.getHttpServer())
      .post(`/journeys/${journeyId}/start`)
      .set(TEST_UID_HEADER, uid);
  }

  async function endJourney(
    uid: string,
    journeyId: string,
  ): Promise<request.Response> {
    return request(app.getHttpServer())
      .post(`/journeys/${journeyId}/end`)
      .set(TEST_UID_HEADER, uid);
  }

  async function getJourney(
    uid: string,
    journeyId: string,
  ): Promise<request.Response> {
    return request(app.getHttpServer())
      .get(`/journeys/${journeyId}`)
      .set(TEST_UID_HEADER, uid);
  }

  // --- JRNY-02: regression -- no active journey, start succeeds ------------

  it('JRNY-02: a leader with no active journey can start their only PENDING journey', async () => {
    const uid = uidFor('jrny02-leader');
    await seedLeader(uid);

    const journeyId = await createJourney(uid, 'JRNY-02 journey');

    const res = await startJourney(uid, journeyId);

    expect(res.status).toBe(201);
    expect((res.body as SuccessBody<JourneyData>).data.status).toBe('ACTIVE');
  });

  // --- JRNY-01: already-active leader gets 409 ------------------------------

  it('JRNY-01: a leader with an ACTIVE journey gets 409 ALREADY_IN_ACTIVE_JOURNEY starting a second PENDING journey', async () => {
    const uid = uidFor('jrny01-leader');
    await seedLeader(uid);

    const journeyAId = await createJourney(uid, 'JRNY-01 journey A');
    const startA = await startJourney(uid, journeyAId);
    expect(startA.status).toBe(201);

    const journeyBId = await createJourney(uid, 'JRNY-01 journey B');
    const startB = await startJourney(uid, journeyBId);

    expect(startB.status).toBe(409);
    const body = startB.body as ErrorBody;
    expect(body.error.code).toBe('ALREADY_IN_ACTIVE_JOURNEY');
    expect(body.error.activeJourneyId).toBe(journeyAId);

    // Journey B must remain PENDING -- the rejected start must not have
    // mutated any state.
    const journeyBCheck = await getJourney(uid, journeyBId);
    expect((journeyBCheck.body as SuccessBody<JourneyData>).data.status).toBe(
      'PENDING',
    );
  });

  // --- JRNY-04: end A then start B succeeds ---------------------------------

  it('JRNY-04: ending journey A then starting journey B succeeds end-to-end for the same leader', async () => {
    const uid = uidFor('jrny04-leader');
    await seedLeader(uid);

    const journeyAId = await createJourney(uid, 'JRNY-04 journey A');
    const startA = await startJourney(uid, journeyAId);
    expect(startA.status).toBe(201);

    const journeyBId = await createJourney(uid, 'JRNY-04 journey B');
    const blockedB = await startJourney(uid, journeyBId);
    expect(blockedB.status).toBe(409);

    const endA = await endJourney(uid, journeyAId);
    expect(endA.status).toBe(201);

    const startB = await startJourney(uid, journeyBId);
    expect(startB.status).toBe(201);
    expect((startB.body as SuccessBody<JourneyData>).data.status).toBe(
      'ACTIVE',
    );
  });

  // --- JRNY-03: race-safety under real concurrency --------------------------

  it('JRNY-03: two concurrent start() calls for the same leader cannot both create ACTIVE journeys', async () => {
    const uid = uidFor('jrny03-leader');
    await seedLeader(uid);

    // Two distinct PENDING journeys for the SAME leader -- both requests
    // target different journeyIds but must race against the same
    // idx_journeys_one_active_per_leader(leader_id) slot, which is exactly
    // the scenario the partial unique index + 23505 catch defends.
    const journeyCId = await createJourney(uid, 'JRNY-03 journey C');
    const journeyDId = await createJourney(uid, 'JRNY-03 journey D');

    // Fire both start() HTTP calls concurrently via Promise.all, each
    // carrying its own explicit per-request uid header (not a shared
    // mutable variable), so they are genuinely in flight together racing
    // against the real partial unique index + the service's transactional
    // pre-check / 23505 catch, with no cross-request identity hazard
    // regardless of how the two requests interleave or resolve.
    const [resC, resD] = await Promise.all([
      request(app.getHttpServer())
        .post(`/journeys/${journeyCId}/start`)
        .set(TEST_UID_HEADER, uid),
      request(app.getHttpServer())
        .post(`/journeys/${journeyDId}/start`)
        .set(TEST_UID_HEADER, uid),
    ]);

    const statuses = [resC.status, resD.status].sort();
    expect(statuses).toEqual([201, 409]);

    const winner = resC.status === 201 ? resC : resD;
    const loser = resC.status === 409 ? resC : resD;

    expect((winner.body as SuccessBody<JourneyData>).data.status).toBe(
      'ACTIVE',
    );
    const loserBody = loser.body as ErrorBody;
    expect(loserBody.error.code).toBe('ALREADY_IN_ACTIVE_JOURNEY');

    // Independently verify DB state -- catches a hypothetical bug where both
    // HTTP responses look right but the underlying rows are inconsistent.
    const journeyCRow = await journeyRepository.findById(journeyCId);
    const journeyDRow = await journeyRepository.findById(journeyDId);
    const dbStatuses = [journeyCRow?.status, journeyDRow?.status].sort();
    expect(dbStatuses).toEqual(['ACTIVE', 'PENDING']);
  });
});
