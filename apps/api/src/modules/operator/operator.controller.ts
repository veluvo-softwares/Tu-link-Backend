import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import {
  ClerkAuthGuard,
  type ClerkRequest,
} from '../../common/guards/clerk-auth.guard';

@Controller('operator')
@UseGuards(ClerkAuthGuard)
export class OperatorController {
  @Get('session')
  getSession(@Req() request: ClerkRequest) {
    return {
      userId: request.clerkAuth?.userId ?? null,
      sessionId: request.clerkAuth?.sessionId ?? null,
      orgId: request.clerkAuth?.orgId ?? null,
      orgRole: request.clerkAuth?.orgRole ?? null,
      orgSlug: request.clerkAuth?.orgSlug ?? null,
      sync: request.clerkSync ?? null,
    };
  }
}
