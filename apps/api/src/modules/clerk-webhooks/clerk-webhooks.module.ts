import { Module } from '@nestjs/common';
import { ClerkOrganizationsRepository } from '../../database/repositories/clerk-organizations.repository';
import { ClerkWebhooksController } from './clerk-webhooks.controller';
import { ClerkWebhooksService } from './clerk-webhooks.service';

@Module({
  controllers: [ClerkWebhooksController],
  providers: [ClerkWebhooksService, ClerkOrganizationsRepository],
})
export class ClerkWebhooksModule {}
