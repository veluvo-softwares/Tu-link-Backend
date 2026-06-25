import { Test, TestingModule } from '@nestjs/testing';
import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
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
  user?: { uid: string; isGuest: boolean };
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

describe('Journey start (e2e) -- JRNY-01..04', () => {
  let app: INestApplication<App>;
  let usersRepository: UsersRepository;
  let journeyRepository: JourneyRepository;
  let databaseService: DatabaseService;

  // The guard override reads this mutable variable on every request, letting
  // each test act as a different leader uid without rebuilding the module.
  let currentUid = 'unset';

  const createdUserIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(FirebaseAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest<MockAuthRequest>();
          req.user = { uid: currentUid, isGuest: false };
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
    // Best-effort cleanup so reruns don't accumulate rows. Each test uses a
    // unique uid per run-scoped suffix would be ideal, but since uids here
    // are fixed per test case, delete by leader_id (cascades to no FKs from
    // journeys) then the seeded user row itself.
    for (const uid of createdUserIds) {
      try {
        await databaseService.db.execute(
          `DELETE FROM journeys WHERE leader_id = '${uid}'`,
        );
        await databaseService.db.execute(
          `DELETE FROM users WHERE id = '${uid}'`,
        );
      } catch {
        // Non-fatal -- harmless to leave test rows in the local dev DB if
        // cleanup fails; unique per-suite-run uids avoid cross-run collisions.
      }
    }
    await app.close();
  });

  async function seedLeader(uid: string): Promise<void> {
    const existing = await usersRepository.findById(uid);
    if (!existing) {
      await usersRepository.create({
        id: uid,
        email: `${uid}@example.com`,
        displayName: uid,
      });
      createdUserIds.push(uid);
    }
  }

  async function createJourney(uid: string, name: string): Promise<string> {
    currentUid = uid;
    const res = await request(app.getHttpServer())
      .post('/journeys')
      .send({ name });
    expect(res.status).toBe(201);
    return (res.body as SuccessBody<JourneyData>).data.id;
  }

  async function startJourney(
    uid: string,
    journeyId: string,
  ): Promise<request.Response> {
    currentUid = uid;
    return request(app.getHttpServer()).post(`/journeys/${journeyId}/start`);
  }

  async function endJourney(
    uid: string,
    journeyId: string,
  ): Promise<request.Response> {
    currentUid = uid;
    return request(app.getHttpServer()).post(`/journeys/${journeyId}/end`);
  }

  async function getJourney(
    uid: string,
    journeyId: string,
  ): Promise<request.Response> {
    currentUid = uid;
    return request(app.getHttpServer()).get(`/journeys/${journeyId}`);
  }

  // --- JRNY-02: regression -- no active journey, start succeeds ------------

  it('JRNY-02: a leader with no active journey can start their only PENDING journey', async () => {
    const uid = 'jrny02-leader';
    await seedLeader(uid);

    const journeyId = await createJourney(uid, 'JRNY-02 journey');

    const res = await startJourney(uid, journeyId);

    expect(res.status).toBe(201);
    expect((res.body as SuccessBody<JourneyData>).data.status).toBe('ACTIVE');
  });

  // --- JRNY-01: already-active leader gets 409 ------------------------------

  it('JRNY-01: a leader with an ACTIVE journey gets 409 ALREADY_IN_ACTIVE_JOURNEY starting a second PENDING journey', async () => {
    const uid = 'jrny01-leader';
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
    const uid = 'jrny04-leader';
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
    const uid = 'jrny03-leader';
    await seedLeader(uid);

    const journeyCId = await createJourney(uid, 'JRNY-03 journey C');
    const journeyDId = await createJourney(uid, 'JRNY-03 journey D');

    // Fire both start() HTTP calls concurrently via Promise.all so they are
    // genuinely in flight together, racing against the real partial unique
    // index + the service's transactional pre-check / 23505 catch.
    currentUid = uid;
    const [resC, resD] = await Promise.all([
      request(app.getHttpServer()).post(`/journeys/${journeyCId}/start`),
      request(app.getHttpServer()).post(`/journeys/${journeyDId}/start`),
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
