import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TuLinkResendEmailService } from './tulink-resend-email.service';

@Module({
  imports: [ConfigModule],
  providers: [
    TuLinkResendEmailService,
    {
      provide: 'EMAIL_SERVICE',
      useExisting: TuLinkResendEmailService,
    },
  ],
  exports: [TuLinkResendEmailService, 'EMAIL_SERVICE'],
})
export class EmailModule {}
