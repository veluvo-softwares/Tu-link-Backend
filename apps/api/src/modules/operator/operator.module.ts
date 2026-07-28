import { Module } from '@nestjs/common';
import { ClerkOrganizationsRepository } from '../../database/repositories/clerk-organizations.repository';
import { ClerkIdentitySyncService } from './services/clerk-identity-sync.service';
import { ClerkAuthGuard } from '../../common/guards/clerk-auth.guard';
import { OperatorController } from './operator.controller';

@Module({
  controllers: [OperatorController],
  providers: [
    ClerkAuthGuard,
    ClerkIdentitySyncService,
    ClerkOrganizationsRepository,
  ],
})
export class OperatorModule {}
