import { BadRequestException, Controller, Post, Req } from '@nestjs/common';
import type { WebhookEvent } from '@clerk/backend';
import { verifyWebhook } from '@clerk/backend/webhooks';
import type { Request } from 'express';
import { ClerkWebhooksService } from './clerk-webhooks.service';

interface ClerkWebhookRequest extends Request {
  rawBody?: Buffer;
}

@Controller('webhooks/clerk')
export class ClerkWebhooksController {
  constructor(private readonly clerkWebhooksService: ClerkWebhooksService) {}

  @Post()
  async handle(@Req() request: ClerkWebhookRequest) {
    if (!request.rawBody) {
      return { success: false, message: 'Missing raw body' };
    }

    const webhookRequest = new Request(
      `${request.protocol}://${request.get('host')}${request.originalUrl}`,
      {
        method: request.method,
        headers: request.headers as HeadersInit,
        body: request.rawBody.toString('utf8'),
      },
    );

    let evt: WebhookEvent;
    try {
      evt = await verifyWebhook(webhookRequest);
    } catch {
      throw new BadRequestException('Clerk webhook verification failed');
    }
    await this.clerkWebhooksService.handleEvent(evt);

    return { success: true };
  }
}
