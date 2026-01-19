import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { TimestampConversionInterceptor } from './common/interceptors/timestamp-conversion.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable CORS
  app.enableCors({
    origin: process.env.WS_CORS_ORIGIN || '*',
    credentials: true,
  });

  // Global exception filter for standardized error responses
  app.useGlobalFilters(new HttpExceptionFilter());

  // Global interceptor to convert Firestore Timestamps to ISO 8601 strings
  // This MUST run before ResponseInterceptor
  app.useGlobalInterceptors(new TimestampConversionInterceptor());

  // Global response interceptor for standardized success responses
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

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log(`
    🚀 Tu-link Backend is running on: http://localhost:${port}
    📚 API Documentation: http://localhost:${port}/api
    🔌 WebSocket Gateway: ws://localhost:${port}
  `);
}
bootstrap();
