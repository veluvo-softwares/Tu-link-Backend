import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TuLinkResendEmailService } from './tulink-resend-email.service';

@Module({
  imports: [ConfigModule],
  providers: [
    TuLinkResendEmailService, // TuLink-branded email service (primary)
    {
      provide: 'EMAIL_SERVICE', // Use TuLink service as the primary email service
      useClass: TuLinkResendEmailService,
    },
  ],
  exports: [TuLinkResendEmailService, 'EMAIL_SERVICE'],
})
export class EmailModule {}
