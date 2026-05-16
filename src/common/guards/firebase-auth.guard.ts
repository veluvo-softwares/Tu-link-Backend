import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { FirebaseService } from '../../shared/firebase/firebase.service';

interface AuthRequest {
  headers: {
    authorization?: string;
  };
  user?: {
    uid: string;
    email?: string;
    emailVerified?: boolean;
  };
}

@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  constructor(private firebaseService: FirebaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('Please login again');
    }

    try {
      const decodedToken = await this.firebaseService.auth.verifyIdToken(token);

      const userRecord = await this.firebaseService.auth.getUser(
        decodedToken.uid,
      );

      if (userRecord.tokensValidAfterTime) {
        const tokenIssuedAt = new Date(decodedToken.iat * 1000);
        const tokensValidAfter = new Date(userRecord.tokensValidAfterTime);

        if (tokenIssuedAt < tokensValidAfter) {
          throw new UnauthorizedException({
            message: 'Please login again',
            code: 'TOKEN_REVOKED',
          });
        }
      }

      request.user = {
        uid: decodedToken.uid,
        email: decodedToken.email,
        emailVerified: decodedToken.email_verified,
      };
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      // Surface expired-token separately so the Flutter client can silently
      // refresh via FirebaseAuth.currentUser.getIdToken(true) instead of
      // prompting a full re-login.
      const firebaseError = error as { errorInfo?: { code?: string } };
      const code: string = firebaseError.errorInfo?.code ?? '';
      if (code === 'auth/id-token-expired') {
        throw new UnauthorizedException({
          message: 'Token expired, please refresh',
          code: 'TOKEN_EXPIRED',
        });
      }
      throw new UnauthorizedException({
        message: 'Please login again',
        code: 'AUTH_FAILED',
      });
    }
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
