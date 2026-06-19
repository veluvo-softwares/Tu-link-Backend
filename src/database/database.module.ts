import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import databaseConfig from '../config/database.config';
import { DatabaseService } from './database.service';
import { JourneyRepository } from './repositories/journey.repository';
import { ParticipantRepository } from './repositories/participant.repository';
import { UsersRepository } from './repositories/users.repository';

const repositories = [
  UsersRepository,
  JourneyRepository,
  ParticipantRepository,
];

@Global()
@Module({
  imports: [ConfigModule.forFeature(databaseConfig)],
  providers: [DatabaseService, ...repositories],
  exports: [DatabaseService, ...repositories],
})
export class DatabaseModule {}
