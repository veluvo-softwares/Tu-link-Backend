import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthMetricsService } from './services/auth-metrics.service';
import { FirebaseModule } from '../../shared/firebase/firebase.module';
import { EmailModule } from '../../shared/email/email.module';

@Module({
  imports: [FirebaseModule, EmailModule],
  controllers: [AuthController],
  providers: [AuthService, AuthMetricsService],
  exports: [AuthService, AuthMetricsService],
})
export class AuthModule {}
