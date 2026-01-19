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
    .setTitle('Tu-link API')
    .setDescription(
      'Real-time convoy coordination backend with WebSocket support',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('auth', 'Authentication endpoints')
    .addTag('journeys', 'Journey management')
    .addTag('locations', 'Location tracking')
    .addTag('notifications', 'Notifications')
    .addTag('analytics', 'Journey analytics')
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
