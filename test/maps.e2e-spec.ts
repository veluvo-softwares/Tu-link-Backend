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
import { LoggerService } from './../src/shared/logger/logger.service';

interface MockAuthRequest {
  user?: { uid: string; isGuest: boolean };
}

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
      .compile();

    app = moduleFixture.createNestApplication();

    const logger = app.get(LoggerService);
    app.useGlobalFilters(new HttpExceptionFilter(logger));
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

  it('boots the app', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ places: [] }),
    } as unknown as Response);

    const res = await request(app.getHttpServer()).get('/maps/search?query=x');
    expect(res.status).toBeDefined();
  });
});
