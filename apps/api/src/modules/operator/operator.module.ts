import { Module } from '@nestjs/common';
import { ClerkOrganizationsRepository } from '../../database/repositories/clerk-organizations.repository';
import { ClerkIdentitySyncService } from './services/clerk-identity-sync.service';
import { ClerkAuthGuard } from '../../common/guards/clerk-auth.guard';
import { OperatorController } from './operator.controller';
import { OperatorAccessService } from './services/operator-access.service';
import { LocationModule } from '../location/location.module';

@Module({
  imports: [LocationModule],
  controllers: [OperatorController],
  providers: [
    ClerkAuthGuard,
    ClerkIdentitySyncService,
    ClerkOrganizationsRepository,
    OperatorAccessService,
  ],
})
export class OperatorModule {}
