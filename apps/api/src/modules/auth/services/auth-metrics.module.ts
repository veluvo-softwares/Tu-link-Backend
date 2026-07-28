import { Global, Module } from '@nestjs/common';
import { AuthMetricsService } from './auth-metrics.service';

// FirebaseAuthGuard depends on AuthMetricsService and is applied via
// @UseGuards in controllers across multiple feature modules (analytics,
// journey, location, maps, notification) that do not import AuthModule.
// AuthMetricsService only depends on RedisService/LoggerService, both
// already @Global() — so this module follows the same global-infra pattern
// (see RedisModule, LoggerModule, FirebaseModule) to make it resolvable
// wherever the guard is instantiated, without each feature module having to
// import AuthModule just for guard plumbing.
@Global()
@Module({
  providers: [AuthMetricsService],
  exports: [AuthMetricsService],
})
export class AuthMetricsModule {}
