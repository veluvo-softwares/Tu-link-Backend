import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  getClerkAuthorizedParties,
  getClerkClient,
} from '../../shared/clerk/clerk.client';
import { ClerkIdentitySyncService } from '../../modules/operator/services/clerk-identity-sync.service';
import type { ClerkSyncResult } from '../../modules/operator/services/clerk-identity-sync.service';

export interface ClerkAuthContext {
  userId: string;
  sessionId?: string;
  orgId?: string | null;
  organizationId?: string | null;
  orgRole?: string | null;
  orgSlug?: string | null;
  orgPermissions?: string[] | null;
}

export interface ClerkRequest extends Request {
  clerkAuth?: ClerkAuthContext;
  clerkSync?: ClerkSyncResult;
}

@Injectable()
export class ClerkAuthGuard implements CanActivate {
  constructor(
    private readonly clerkIdentitySyncService: ClerkIdentitySyncService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ClerkRequest>();
    const requestUrl = `${request.protocol}://${request.get('host')}${request.originalUrl}`;
    const headers = new Headers();

    for (const [key, value] of Object.entries(request.headers)) {
      if (typeof value === 'string') {
        headers.set(key, value);
      } else if (Array.isArray(value)) {
        headers.set(key, value.join(', '));
      }
    }

    const clerkClient = getClerkClient();
    const authenticatedRequest = new Request(requestUrl, {
      method: request.method,
      headers,
    });

    const authState = await clerkClient.authenticateRequest(
      authenticatedRequest,
      { authorizedParties: getClerkAuthorizedParties() },
    );

    if (!authState.isAuthenticated) {
      throw new UnauthorizedException('Clerk session required');
    }

    request.clerkAuth = authState.toAuth();

    if (request.clerkAuth.userId) {
      try {
        request.clerkSync =
          await this.clerkIdentitySyncService.syncUserOrganizations(
            request.clerkAuth.userId,
            request.clerkAuth.orgId ?? null,
          );
      } catch (error) {
        console.warn('Clerk organization sync failed', error);
        throw new ServiceUnavailableException(
          'Authorization state is temporarily unavailable',
        );
      }
    }

    return true;
  }
}
