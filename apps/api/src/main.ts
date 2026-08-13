import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { LoggerService } from './shared/logger/logger.service';
import { getAllowedOrigins } from './shared/security/cors';
import { assertClerkEnvironment } from './shared/clerk/clerk.env';

async function bootstrap() {
  // Fail fast on Clerk misconfiguration. The deployed API runs against a Clerk
  // production instance and local development against a development instance;
  // a mismatched or wrong-tenant key otherwise stays invisible until the first
  // authenticated request 401s.
  const clerkEnvironment = assertClerkEnvironment();

  // Not fatal -- see clerk.env.ts. Surfaced so that if Clerk webhooks are ever
  // pointed at this API, the resulting 400s are traceable to a missing secret
  // rather than looking like Clerk misbehaving.
  if (
    process.env.NODE_ENV === 'production' &&
    !clerkEnvironment.webhookSigningSecret
  ) {
    console.warn(
      'CLERK_WEBHOOK_SIGNING_SECRET is not set: Clerk webhooks will be ' +
        'rejected. Organization access still syncs on each authenticated ' +
        'request; deleted organizations will not be cleaned up.',
    );
  }

  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Enable CORS
  app.enableCors({
    origin: getAllowedOrigins(),
    credentials: true,
  });

  // Get the LoggerService from the app context
  const logger = app.get(LoggerService);

  // Global exception filter for standardized error responses
  app.useGlobalFilters(new HttpExceptionFilter(logger));

  // Global response interceptor for standardized success responses.
  // (Postgres timestamptz columns serialize to ISO 8601 natively, so the
  // former Firestore Timestamp conversion interceptor is no longer needed.)
  app.useGlobalInterceptors(new ResponseInterceptor());

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Swagger documentation setup
  const config = new DocumentBuilder()
    .setTitle('Tu-Link Backend API')
    .setDescription(
      `Complete API for Tu-Link convoy coordination backend with real-time location tracking.

## Features
- **Real-time Location Tracking**: WebSocket-based location updates with REST fallback
- **Journey Management**: Create, manage, and coordinate convoy journeys
- **User Authentication**: Firebase Auth integration with token management
- **Notifications**: Journey invitations, lag alerts, and arrival detection
- **Analytics**: Journey statistics and user history
- **Google Maps Integration**: Geocoding, directions, and distance calculations

## Authentication
All protected endpoints require a Bearer token in the Authorization header:
\`\`\`
Authorization: Bearer <your-token-here>
\`\`\`

Get tokens via:
1. **Register**: Create new account (returns token)
2. **Login**: Authenticate with credentials (returns token)
3. **Refresh**: Get new token before expiration (1 hour)

## Response Format
All responses follow a standardized format:

**Success:**
\`\`\`json
{
  "success": true,
  "statusCode": 200,
  "message": "Operation completed successfully",
  "data": { ... }
}
\`\`\`

**Error:**
\`\`\`json
{
  "success": false,
  "statusCode": 400,
  "message": "Validation failed",
  "error": {
    "code": "VALIDATION_ERROR",
    "details": [ ... ]
  }
}
\`\`\`

## Date Format
All timestamps use ISO 8601 format: \`2026-01-19T10:30:00.000Z\`

## WebSocket
For real-time location updates, connect to:
- **Namespace**: \`/location\`
- **URL**: \`ws://localhost:3000/location\`
- **Authentication**: Pass token in connection auth object
      `,
    )
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter Firebase ID token (obtained from login/register)',
      },
      'bearer',
    )
    .addTag('auth', 'Authentication and user profile management')
    .addTag('journeys', 'Journey creation, management, and invitations')
    .addTag('locations', 'Location tracking and history (REST fallback)')
    .addTag('notifications', 'Notification management and delivery')
    .addTag('analytics', 'Journey analytics and user statistics')
    .addTag('maps', 'Google Maps integration (geocoding, directions)')
    .addServer('http://localhost:3000', 'Development')
    .addServer('https://api.tulink.com', 'Production')
    .build();

  const swaggerEnabled =
    process.env.NODE_ENV !== 'production' ||
    process.env.ENABLE_SWAGGER === 'true';
  if (swaggerEnabled) {
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api', app, document);
  }

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log(
    `Tu-link Backend is running on http://localhost:${port}. ` +
      `WebSocket gateway: ws://localhost:${port}` +
      (swaggerEnabled ? `; API docs: http://localhost:${port}/api` : '') +
      // Surfaced at boot so a deploy log makes the active tenant obvious --
      // the cutover's main failure mode is the API and dashboard ending up on
      // different Clerk instances.
      `; Clerk instance: ${clerkEnvironment.instance}`,
  );
}
void bootstrap();
