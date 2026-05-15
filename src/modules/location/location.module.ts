import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LocationController } from './location.controller';
import { LocationService } from './location.service';
import { LocationGateway } from './location.gateway';
import { PriorityService } from './services/priority.service';
import { SequenceService } from './services/sequence.service';
import { AcknowledgmentService } from './services/acknowledgment.service';
import { LagDetectionService } from './services/lag-detection.service';
import { ArrivalDetectionService } from './services/arrival-detection.service';
import { LocationBatchingService } from './services/location-batching.service';
import { WebSocketMetricsService } from './services/websocket-metrics.service';
import { FirebaseModule } from '../../shared/firebase/firebase.module';
import { RedisModule } from '../../shared/redis/redis.module';
import { JourneyModule } from '../journey/journey.module';
import { MapsModule } from '../maps/maps.module';
import appConfig from '../../config/app.config';

@Module({
  imports: [
    ConfigModule.forFeature(appConfig),
    FirebaseModule,
    RedisModule,
    forwardRef(() => JourneyModule),
    MapsModule,
  ],
  controllers: [LocationController],
  providers: [
    LocationService,
    LocationGateway,
    PriorityService,
    SequenceService,
    AcknowledgmentService,
    LagDetectionService,
    ArrivalDetectionService,
    LocationBatchingService,
    WebSocketMetricsService,
  ],
  exports: [LocationService, LocationGateway],
})
export class LocationModule {}
