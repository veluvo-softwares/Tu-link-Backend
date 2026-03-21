import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';

// Configuration
import appConfig from './config/app.config';
import firebaseConfig from './config/firebase.config';
import redisConfig from './config/redis.config';
import mapsConfig from './config/maps.config';

// Shared modules
import { FirebaseModule } from './shared/firebase/firebase.module';
import { RedisModule } from './shared/redis/redis.module';
import { LoggerModule } from './shared/logger/logger.module';

// Feature modules
import { AuthModule } from './modules/auth/auth.module';
import { JourneyModule } from './modules/journey/journey.module';
import { MapsModule } from './modules/maps/maps.module';
import { LocationModule } from './modules/location/location.module';
import { NotificationModule } from './modules/notification/notification.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';

@Module({
  imports: [
    // Global configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, firebaseConfig, redisConfig, mapsConfig],
    }),
    // Shared modules
    LoggerModule,
    FirebaseModule,
    RedisModule,
    // Feature modules
    AuthModule,
    JourneyModule,
    MapsModule,
    LocationModule,
    NotificationModule,
    AnalyticsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
