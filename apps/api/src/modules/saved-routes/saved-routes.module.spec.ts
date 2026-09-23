import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClerkAuthGuard } from '../../common/guards/clerk-auth.guard';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';
import { ClerkOrganizationsRepository } from '../../database/repositories/clerk-organizations.repository';
import { MapsModule } from '../maps/maps.module';
import { ClerkIdentitySyncService } from '../operator/services/clerk-identity-sync.service';
import { OperatorAccessService } from '../operator/services/operator-access.service';
import { OperatorReportRouteService } from '../operator/services/operator-report-route.service';
import { SavedRoutesOperatorController } from './saved-routes-operator.controller';
import { SavedRoutesModule } from './saved-routes.module';
import { SavedRoutesService } from './saved-routes.service';

// Avoid loading the Location -> Journey -> SavedRoutes circular import graph.
jest.mock('../location/location.module', () => ({
  LocationModule: class LocationModule {},
}));

@Module({})
class InfrastructureStubModule {}

describe('SavedRoutesModule', () => {
  it('resolves the operator controller guard and its identity sync dependency', async () => {
    // Keep the real module boundary, Clerk guard, and identity sync service.
    // Stub unrelated services so this startup check needs no external systems.
    const module = await Test.createTestingModule({
      imports: [SavedRoutesModule],
    })
      .overrideModule(MapsModule)
      .useModule(InfrastructureStubModule)
      .overrideProvider(SavedRoutesService)
      .useValue({})
      .overrideProvider(OperatorAccessService)
      .useValue({})
      .overrideProvider(OperatorReportRouteService)
      .useValue({})
      .overrideProvider(ClerkOrganizationsRepository)
      .useValue({})
      .overrideGuard(FirebaseAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    try {
      expect(module.get(SavedRoutesOperatorController)).toBeInstanceOf(
        SavedRoutesOperatorController,
      );
      expect(module.get(ClerkAuthGuard)).toBeInstanceOf(ClerkAuthGuard);
      expect(module.get(ClerkIdentitySyncService)).toBeInstanceOf(
        ClerkIdentitySyncService,
      );
    } finally {
      await module.close();
    }
  });
});
