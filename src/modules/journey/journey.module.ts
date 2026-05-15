import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JourneyController } from './journey.controller';
import { JourneyService } from './journey.service';
import { ParticipantService } from './services/participant.service';
import { JourneyMetricsService } from './services/journey-metrics.service';
import { FirebaseModule } from '../../shared/firebase/firebase.module';
import { RedisModule } from '../../shared/redis/redis.module';
import { NotificationModule } from '../notification/notification.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import appConfig from '../../config/app.config';

@Module({
  imports: [
    ConfigModule.forFeature(appConfig),
    FirebaseModule,
    RedisModule,
    NotificationModule,
    AnalyticsModule,
  ],
  controllers: [JourneyController],
  providers: [JourneyService, ParticipantService, JourneyMetricsService],
  exports: [JourneyService, ParticipantService, JourneyMetricsService],
})
export class JourneyModule {}
