import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { RedisModule } from '../../shared/redis/redis.module';
import { FirebaseModule } from '../../shared/firebase/firebase.module';

@Module({
  imports: [ConfigModule, RedisModule, FirebaseModule],
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}