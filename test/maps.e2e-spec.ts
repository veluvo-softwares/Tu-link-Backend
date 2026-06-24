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
import { HttpExceptionFilter } from './../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from './../src/common/interceptors/response.interceptor';
import { LoggerService } from './../src/shared/logger/logger.service';
import { DatabaseService } from './../src/database/database.service';
import { RedisService } from './../src/shared/redis/redis.service';
import { FirebaseService } from './../src/shared/firebase/firebase.service';

interface MockAuthRequest {
  user?: { uid: string; isGuest: boolean };
}

// supertest types `res.body` as `any`; these shapes let assertions stay type-safe.
interface ErrorBody {
  error: { code: string };
}
interface SuccessBody<T> {
  data: T;
}

// In-memory RedisService stub: the maps service only reads (cache miss -> null)
// and writes (setex) through getClient(). Returning null forces a cache miss so
// every request exercises the real fetch path under test.
const redisClientStub = {
  get: () => Promise.resolve(null),
  setex: () => Promise.resolve('OK'),
};
const redisServiceStub = {
  getClient: () => redisClientStub,
};

// Infra stubs so the full AppModule boots without Postgres / Firebase creds —
// the maps HTTP contract under test depends on neither.
const databaseServiceStub = {
  onModuleInit: () => Promise.resolve(),
  onModuleDestroy: () => Promise.resolve(),
};
const firebaseServiceStub = {
  onModuleInit: () => undefined,
  getAuth: () => ({}),
  getMessaging: () => ({}),
};

describe('MapsController (e2e)', () => {
  let app: INestApplication<App>;
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(FirebaseAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest<MockAuthRequest>();
          req.user = { uid: 'test-uid', isGuest: false };
          return true;
        },
      })
      .overrideProvider(RedisService)
      .useValue(redisServiceStub)
      .overrideProvider(DatabaseService)
      .useValue(databaseServiceStub)
      .overrideProvider(FirebaseService)
      .useValue(firebaseServiceStub)
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

    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  // --- /maps/search ---------------------------------------------------------

  it('MAPS-01: GET /maps/search returns 502 UPSTREAM_PLACES_ERROR on upstream non-2xx', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('upstream error'),
    } as unknown as Response);

    const res = await request(app.getHttpServer()).get(
      '/maps/search?query=cafe',
    );

    expect(res.status).toBe(502);
    expect((res.body as ErrorBody).error.code).toBe('UPSTREAM_PLACES_ERROR');
  });

  it('MAPS-02: GET /maps/search returns 503 UPSTREAM_UNAVAILABLE on fetch abort/timeout', async () => {
    fetchSpy.mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'AbortError' }),
    );

    const res = await request(app.getHttpServer()).get(
      '/maps/search?query=cafe',
    );

    expect(res.status).toBe(503);
    expect((res.body as ErrorBody).error.code).toBe('UPSTREAM_UNAVAILABLE');
  });

  it('MAPS-04: GET /maps/search returns 200 with empty results when upstream has none', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ places: [] }),
    } as unknown as Response);

    const res = await request(app.getHttpServer()).get(
      '/maps/search?query=cafe',
    );

    expect(res.status).toBe(200);
    expect(
      (res.body as SuccessBody<{ results: unknown[] }>).data.results,
    ).toEqual([]);
  });

  // --- /maps/route ----------------------------------------------------------

  const routeBody = {
    originLat: -1.28,
    originLng: 36.82,
    destLat: -1.3,
    destLng: 36.85,
  };

  it('MAPS-03: POST /maps/route returns 502 UPSTREAM_DIRECTIONS_ERROR on upstream non-2xx', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.resolve('mapbox down'),
    } as unknown as Response);

    const res = await request(app.getHttpServer())
      .post('/maps/route')
      .send(routeBody);

    expect(res.status).toBe(502);
    expect((res.body as ErrorBody).error.code).toBe(
      'UPSTREAM_DIRECTIONS_ERROR',
    );
  });

  it('MAPS-03: POST /maps/route returns 503 UPSTREAM_UNAVAILABLE on fetch abort/timeout', async () => {
    fetchSpy.mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'AbortError' }),
    );

    const res = await request(app.getHttpServer())
      .post('/maps/route')
      .send(routeBody);

    expect(res.status).toBe(503);
    expect((res.body as ErrorBody).error.code).toBe('UPSTREAM_UNAVAILABLE');
  });

  it('D-03 regression: POST /maps/route returns 200 with null data when no route found', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ routes: [] }),
    } as unknown as Response);

    const res = await request(app.getHttpServer())
      .post('/maps/route')
      .send(routeBody);

    expect(res.status).toBe(200);
    expect((res.body as SuccessBody<unknown>).data).toBeNull();
  });

  // --- removed route --------------------------------------------------------

  it('MAPS cleanup: GET /maps/reverse returns 404 (route removed)', async () => {
    const res = await request(app.getHttpServer()).get(
      '/maps/reverse?lat=-1.28&lng=36.82',
    );

    expect(res.status).toBe(404);
  });
});
