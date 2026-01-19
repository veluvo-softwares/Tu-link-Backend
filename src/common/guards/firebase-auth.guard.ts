import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { FirebaseService } from '../../shared/firebase/firebase.service';

@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  constructor(private firebaseService: FirebaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('No authentication token provided');
    }

    try {
      // Verify the ID token
      const decodedToken =
        await this.firebaseService.auth.verifyIdToken(token);

      // Get user record to check if tokens have been revoked
      const userRecord = await this.firebaseService.auth.getUser(decodedToken.uid);

      // Check if the token was issued before the revocation time
      // tokensValidAfterTime is set when revokeRefreshTokens() is called
      if (userRecord.tokensValidAfterTime) {
        const tokenIssuedAt = new Date(decodedToken.iat * 1000);
        const tokensValidAfter = new Date(userRecord.tokensValidAfterTime);

        if (tokenIssuedAt < tokensValidAfter) {
          throw new UnauthorizedException('Token has been revoked. Please login again.');
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
      throw new UnauthorizedException('Invalid authentication token');
    }
  }

  private extractTokenFromHeader(request: any): string | null {
    const authHeader = request.headers.authorization;
    if (!authHeader) {
      return null;
    }

    const [type, token] = authHeader.split(' ');
    return type === 'Bearer' ? token : null;
  }
}
