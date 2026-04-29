import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JourneyController } from './journey.controller';
import { JourneyService } from './journey.service';
import { ParticipantService } from './services/participant.service';
import { FirebaseModule } from '../../shared/firebase/firebase.module';
import { RedisModule } from '../../shared/redis/redis.module';
import { NotificationModule } from '../notification/notification.module';
import { LocationModule } from '../location/location.module';
import appConfig from '../../config/app.config';

@Module({
  imports: [
    ConfigModule.forFeature(appConfig),
    FirebaseModule,
    RedisModule,
    NotificationModule,
    forwardRef(() => LocationModule),
  ],
  controllers: [JourneyController],
  providers: [JourneyService, ParticipantService],
  exports: [JourneyService, ParticipantService],
})
export class JourneyModule {}
