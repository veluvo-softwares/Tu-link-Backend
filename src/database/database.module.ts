import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import databaseConfig from '../config/database.config';
import { DatabaseService } from './database.service';
import { AnalyticsRepository } from './repositories/analytics.repository';
import { FcmTokenRepository } from './repositories/fcm-token.repository';
import { JourneyRepository } from './repositories/journey.repository';
import { LagAlertRepository } from './repositories/lag-alert.repository';
import { LocationRepository } from './repositories/location.repository';
import { NotificationRepository } from './repositories/notification.repository';
import { ParticipantRepository } from './repositories/participant.repository';
import { UsersRepository } from './repositories/users.repository';

const repositories = [
  UsersRepository,
  JourneyRepository,
  ParticipantRepository,
  LocationRepository,
  LagAlertRepository,
  NotificationRepository,
  FcmTokenRepository,
  AnalyticsRepository,
];

@Global()
@Module({
  imports: [ConfigModule.forFeature(databaseConfig)],
  providers: [DatabaseService, ...repositories],
  exports: [DatabaseService, ...repositories],
})
export class DatabaseModule {}
