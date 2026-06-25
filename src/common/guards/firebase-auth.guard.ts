import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebaseService } from '../../shared/firebase/firebase.service';
import { RedisService } from '../../shared/redis/redis.service';
import { AuthMetricsService } from '../../modules/auth/services/auth-metrics.service';
import { LoggerService } from '../../shared/logger/logger.service';

interface AuthRequest {
  headers: {
    authorization?: string;
  };
  user?: {
    uid: string;
    email?: string;
    emailVerified?: boolean;
    isGuest?: boolean;
  };
}

// Verified against firebase-admin@14.0.0 source per 02-RESEARCH.md Pattern 1.
// Do not add or remove entries without re-verifying against the SDK source.
const TRANSIENT_REVOCATION_CHECK_CODES = new Set<string>([
  'app/network-error',
  'app/network-timeout',
  'auth/internal-error',
]);

// Reserved cache value meaning "checked, no revocation timestamp to compare."
// Not a valid ISO-8601 date string (no real tokensValidAfterTime can ever
// equal this), so it can never collide with a real Firebase timestamp.
const NO_REVOCATION_SENTINEL = 'NO_REVOCATION';

function isTransientRevocationError(error: unknown): boolean {
  const code =
    (error as { errorInfo?: { code?: string }; code?: string }).errorInfo
      ?.code ?? (error as { code?: string }).code;
  return typeof code === 'string' && TRANSIENT_REVOCATION_CHECK_CODES.has(code);
}

@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  constructor(
    private firebaseService: FirebaseService,
    private redisService: RedisService,
    private configService: ConfigService,
    private authMetricsService: AuthMetricsService,
    private logger: LoggerService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('Please login again');
    }

    let decodedToken: Awaited<
      ReturnType<typeof this.firebaseService.auth.verifyIdToken>
    >;

    try {
      decodedToken = await this.firebaseService.auth.verifyIdToken(token);
    } catch (error) {
      // Surface expired-token separately so the Flutter client can silently
      // refresh via FirebaseAuth.currentUser.getIdToken(true) instead of
      // prompting a full re-login.
      const firebaseError = error as { errorInfo?: { code?: string } };
      const code: string = firebaseError.errorInfo?.code ?? '';
      if (code === 'auth/id-token-expired') {
        throw new UnauthorizedException(
          'Token expired, please refresh',
          'TOKEN_EXPIRED',
        );
      }
      this.logger.error(
        'FirebaseAuthGuard token verification failed:',
        undefined,
        'FirebaseAuthGuard',
        { code: code || String(error) },
      );
      throw new UnauthorizedException('Please login again', 'AUTH_FAILED');
    }

    const isGuest = decodedToken.firebase?.sign_in_provider === 'anonymous';

    // Skip revocation check for anonymous sessions — they have no re-login path
    // and getUser can fail with auth/user-not-found after account deletion.
    if (!isGuest) {
      const uid = decodedToken.uid;
      let tokensValidAfterTime: string | null =
        await this.redisService.getCachedRevocation(uid);

      if (tokensValidAfterTime === NO_REVOCATION_SENTINEL) {
        // Cache hit on "checked, no revocation" — skip getUser() and skip
        // the iat comparison entirely. Terminal early return.
        request.user = {
          uid: decodedToken.uid,
          email: decodedToken.email,
          emailVerified: decodedToken.email_verified,
          isGuest,
        };
        return true;
      } else if (tokensValidAfterTime === null) {
        try {
          const userRecord = await this.firebaseService.auth.getUser(uid);
          tokensValidAfterTime = userRecord.tokensValidAfterTime ?? null;

          const ttl =
            this.configService.get<number>('auth.revocationCacheTtlSeconds') ??
            60;
          await this.redisService.setCachedRevocation(
            uid,
            tokensValidAfterTime ?? NO_REVOCATION_SENTINEL,
            ttl,
          );
        } catch (error) {
          if (isTransientRevocationError(error)) {
            const code =
              (error as { errorInfo?: { code?: string }; code?: string })
                .errorInfo?.code ??
              (error as { code?: string }).code ??
              '';
            await this.authMetricsService.recordTransientBypass(uid, code);

            request.user = {
              uid: decodedToken.uid,
              email: decodedToken.email,
              emailVerified: decodedToken.email_verified,
              isGuest,
            };
            return true;
          }

          this.logger.error(
            'FirebaseAuthGuard revocation check failed:',
            undefined,
            'FirebaseAuthGuard',
            {
              code:
                (error as { errorInfo?: { code?: string }; code?: string })
                  .errorInfo?.code ??
                (error as { code?: string }).code ??
                String(error),
            },
          );
          throw new UnauthorizedException('Please login again', 'AUTH_FAILED');
        }
      }

      if (tokensValidAfterTime) {
        const tokenIssuedAt = new Date(decodedToken.iat * 1000);
        const tokensValidAfter = new Date(tokensValidAfterTime);

        if (tokenIssuedAt < tokensValidAfter) {
          throw new UnauthorizedException(
            'Please login again',
            'TOKEN_REVOKED',
          );
        }
      }
    }

    request.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      emailVerified: decodedToken.email_verified,
      isGuest,
    };
    return true;
  }

  private extractTokenFromHeader(request: AuthRequest): string | null {
    const authHeader = request.headers.authorization;
    if (!authHeader) {
      return null;
    }

    const [type, token] = authHeader.split(' ');
    return type === 'Bearer' ? token : null;
  }
}
