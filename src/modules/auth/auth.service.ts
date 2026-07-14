/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
  Injectable,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FirebaseService } from '../../shared/firebase/firebase.service';
import {
  UsersRepository,
  UpdateUserInput,
} from '../../database/repositories/users.repository';
import { TuLinkResendEmailService } from '../../shared/email/tulink-resend-email.service';
import { RedisService } from '../../shared/redis/redis.service';
import { LoggerService } from '../../shared/logger/logger.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { SocialLoginDto } from './dto/social-login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { User } from '../../shared/interfaces/user.interface';
import { AuthResponse } from './interfaces/auth-response.interface';
import {
  SearchUserResponse,
  SearchUserResult,
} from './interfaces/search-user-response.interface';
import {
  VerificationResponse,
  EmailVerificationResponse,
} from './interfaces/verification-response.interface';
import axios from 'axios';

@Injectable()
export class AuthService {
  private readonly FIREBASE_AUTH_API =
    'https://identitytoolkit.googleapis.com/v1/accounts';
  private readonly firebaseApiKey: string;
  // requestUri required by accounts:signInWithIdp (the federated sign-in flow).
  private readonly firebaseAuthDomain: string;

  constructor(
    private firebaseService: FirebaseService,
    private usersRepository: UsersRepository,
    private configService: ConfigService,
    private emailService: TuLinkResendEmailService,
    private redisService: RedisService,
    private eventEmitter: EventEmitter2,
    private logger: LoggerService,
  ) {
    this.firebaseApiKey =
      this.configService.get<string>('firebase.apiKey') || '';
    if (!this.firebaseApiKey) {
      throw new Error('Firebase API Key is not configured');
    }
    this.firebaseAuthDomain =
      this.configService.get<string>('firebase.authDomain') ||
      'https://localhost';
  }

  async register(registerDto: RegisterDto): Promise<AuthResponse> {
    try {
      // Create Firebase Auth user
      interface CreateUserPayload {
        email: string;
        password: string;
        displayName: string;
        phoneNumber?: string;
      }

      const createUserPayload: CreateUserPayload = {
        email: registerDto.email,
        password: registerDto.password,
        displayName: registerDto.displayName,
      };

      // Only add phoneNumber if provided
      if (registerDto.phoneNumber) {
        createUserPayload.phoneNumber = registerDto.phoneNumber;
      }

      const userRecord =
        await this.firebaseService.auth.createUser(createUserPayload);

      // Create the Postgres user row (PK = Firebase UID; invariant A). If this
      // fails we must delete the just-created Firebase user, otherwise a Firebase
      // identity would exist with no corresponding DB row (orphan).
      try {
        await this.usersRepository.create({
          id: userRecord.uid,
          email: registerDto.email,
          displayName: registerDto.displayName,
          phoneNumber: registerDto.phoneNumber,
          emailVerified: false,
          phoneVerified: false,
        });
      } catch (dbError) {
        await this.firebaseService.auth
          .deleteUser(userRecord.uid)
          .catch((cleanupError) =>
            console.error(
              `Failed to roll back Firebase user ${userRecord.uid} after DB write failure:`,
              cleanupError,
            ),
          );
        throw dbError;
      }

      // Sign in the user to get an ID token and refresh token
      const signInResponse = await axios.post(
        `${this.FIREBASE_AUTH_API}:signInWithPassword?key=${this.firebaseApiKey}`,
        {
          email: registerDto.email,
          password: registerDto.password,
          returnSecureToken: true,
        },
      );

      const { idToken, refreshToken, expiresIn } = signInResponse.data as {
        idToken: string;
        refreshToken: string;
        expiresIn: string;
      };

      // Automatically send email verification after successful registration
      try {
        await this.sendEmailVerification(userRecord.uid);
        console.log(
          `Email verification automatically sent to ${registerDto.email}`,
        );
      } catch (emailError) {
        console.warn(
          `Failed to send automatic email verification to ${registerDto.email}:`,
          emailError,
        );
        // Don't fail registration if email sending fails
      }

      return {
        user: {
          uid: userRecord.uid,
          email: registerDto.email,
          displayName: registerDto.displayName,
          phoneNumber: registerDto.phoneNumber,
          emailVerified: false,
        },
        tokens: {
          idToken,
          refreshToken,
          expiresIn: parseInt(expiresIn),
        },
      };
    } catch (error: unknown) {
      // Handle specific Firebase errors

      if ((error as { code?: string }).code === 'auth/email-already-exists') {
        throw new ConflictException('Email address is already in use');
      }

      if ((error as { code?: string }).code === 'auth/invalid-email') {
        throw new ConflictException('Invalid email address');
      }

      if ((error as { code?: string }).code === 'auth/invalid-password') {
        throw new ConflictException('Password must be at least 6 characters');
      }

      if (
        (error as { code?: string }).code === 'auth/phone-number-already-exists'
      ) {
        throw new ConflictException('Phone number is already in use');
      }

      // Re-throw the error to be handled by the global exception filter
      throw error;
    }
  }

  async login(loginDto: LoginDto): Promise<AuthResponse> {
    try {
      // Verify credentials using Firebase REST API
      const response = await axios.post(
        `${this.FIREBASE_AUTH_API}:signInWithPassword?key=${this.firebaseApiKey}`,
        {
          email: loginDto.email,
          password: loginDto.password,
          returnSecureToken: true,
        },
      );

      const { localId, email, idToken, refreshToken, expiresIn } =
        response.data as {
          localId: string;
          email: string;
          idToken: string;
          refreshToken: string;
          expiresIn: string;
          emailVerified?: boolean;
        };

      // Get Firebase Auth user record (has the correct email verification status)
      const firebaseUser = await this.firebaseService.auth.getUser(localId);

      // Get user data from Postgres
      const userData = await this.usersRepository.findById(localId);

      if (!userData) {
        throw new NotFoundException('User profile not found');
      }

      // Sync email verification status between Firebase Auth and Postgres
      const authEmailVerified = firebaseUser.emailVerified;
      const dbEmailVerified = userData.emailVerified;

      if (authEmailVerified !== dbEmailVerified) {
        console.log(
          `Syncing email verification status: Firebase Auth=${authEmailVerified}, DB=${dbEmailVerified}`,
        );

        await this.usersRepository.update(localId, {
          emailVerified: authEmailVerified,
        });
      }

      // Return the ID token and refresh token from Firebase
      return {
        user: {
          uid: localId,
          email: email,
          displayName: userData.displayName || '',
          phoneNumber: userData.phoneNumber ?? undefined,
          emailVerified: authEmailVerified, // Use Firebase Auth as source of truth
        },
        tokens: {
          idToken,
          refreshToken,
          expiresIn: parseInt(expiresIn),
        },
      };
    } catch (error) {
      // A missing Postgres profile (or any deliberate Nest HTTP error) must
      // propagate as-is — don't let the Firebase-REST handling below collapse
      // it into a generic 401.
      if (
        error instanceof NotFoundException ||
        error instanceof UnauthorizedException
      ) {
        throw error;
      }

      if (error.response?.data?.error) {
        const firebaseError = error.response.data.error;

        if (
          firebaseError.message === 'INVALID_PASSWORD' ||
          firebaseError.message === 'EMAIL_NOT_FOUND'
        ) {
          throw new UnauthorizedException('Invalid email or password');
        }

        if (firebaseError.message === 'USER_DISABLED') {
          throw new UnauthorizedException('This account has been disabled');
        }

        if (firebaseError.message === 'TOO_MANY_ATTEMPTS_TRY_LATER') {
          throw new UnauthorizedException(
            'Too many failed login attempts. Please try again later',
          );
        }

        if (firebaseError.message === 'INVALID_EMAIL') {
          throw new UnauthorizedException('Invalid email address');
        }

        if (firebaseError.message === 'WEAK_PASSWORD') {
          throw new UnauthorizedException('Password is too weak');
        }

        // Handle any other Firebase error messages
        if (firebaseError.message) {
          throw new UnauthorizedException(
            'Login failed. Please check your credentials and try again',
          );
        }
      }

      // More specific fallback message
      throw new UnauthorizedException(
        'Unable to sign in. Please verify your email and password are correct',
      );
    }
  }

  async getProfile(uid: string): Promise<User> {
    // Get Firebase Auth user for accurate email verification status
    const firebaseUser = await this.firebaseService.auth.getUser(uid);

    const userData = await this.usersRepository.findById(uid);

    if (!userData) {
      throw new NotFoundException('User not found');
    }

    // Sync email verification status if needed
    const authEmailVerified = firebaseUser.emailVerified;
    const dbEmailVerified = userData.emailVerified;

    if (authEmailVerified !== dbEmailVerified) {
      console.log(
        `Syncing profile email verification: Firebase Auth=${authEmailVerified}, DB=${dbEmailVerified}`,
      );

      await this.usersRepository.update(uid, {
        emailVerified: authEmailVerified,
      });
    }

    // timestamptz columns serialize to ISO 8601 natively — no conversion needed.
    // Override emailVerified without mutating the repository's row object.
    return {
      ...userData,
      emailVerified: authEmailVerified,
    } as unknown as User;
  }

  async updateProfile(
    uid: string,
    updateProfileDto: UpdateProfileDto,
  ): Promise<User> {
    // Update Firebase Auth
    await this.firebaseService.auth.updateUser(uid, updateProfileDto);

    // Update the Postgres user row (updated_at is bumped by the repository)
    await this.usersRepository.update(uid, updateProfileDto);

    return this.getProfile(uid);
  }

  async verifyToken(token: string): Promise<any> {
    try {
      return await this.firebaseService.auth.verifyIdToken(token);
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }

  async refreshToken(
    refreshToken: string,
  ): Promise<{ idToken: string; refreshToken: string; expiresIn: number }> {
    try {
      // Use Firebase REST API to exchange refresh token for new ID token
      const response = await axios.post(
        `https://securetoken.googleapis.com/v1/token?key=${this.firebaseApiKey}`,
        {
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        },
      );

      const { id_token, refresh_token, expires_in } = response.data as {
        id_token: string;
        refresh_token: string;
        expires_in: string;
      };

      return {
        idToken: id_token,
        refreshToken: refresh_token,
        expiresIn: parseInt(expires_in),
      };
    } catch (error: unknown) {
      const axiosError = error as {
        response?: {
          status?: number;
          data?: { error?: { message?: string } };
        };
      };
      const firebaseMessage = axiosError.response?.data?.error?.message;

      // Definitive rejection: the refresh token itself is dead. Only THESE
      // cases warrant clearing the session — the client will log the user out.
      if (
        firebaseMessage === 'TOKEN_EXPIRED' ||
        firebaseMessage === 'INVALID_REFRESH_TOKEN' ||
        firebaseMessage === 'USER_DISABLED' ||
        firebaseMessage === 'USER_NOT_FOUND'
      ) {
        throw new UnauthorizedException(
          'Refresh token expired or invalid. Please login again.',
        );
      }

      // Transient upstream failure — a network error reaching Firebase, a
      // Firebase 5xx, or a response with no recognizable error body. This is
      // NOT the user's fault and is recoverable, so surface 503 (not 401) so the
      // client retries instead of destroying a still-valid session. This is the
      // fix for spurious offline / mid-journey logouts: a brief blip must never
      // sign the user out.
      const upstreamStatus = axiosError.response?.status;
      if (upstreamStatus === undefined || upstreamStatus >= 500) {
        throw new ServiceUnavailableException(
          'Auth service temporarily unavailable, please retry.',
        );
      }

      // Any other 4xx we can't positively classify as recoverable — treat as an
      // auth failure and require re-login (safer than looping on a bad token).
      throw new UnauthorizedException('Failed to refresh token');
    }
  }

  async logout(uid: string): Promise<{ message: string }> {
    try {
      await this.firebaseService.auth.revokeRefreshTokens(uid);

      await this.redisService.invalidateRevocationCache(uid);

      // Force-disconnect any live /location sockets for this uid, scoped to
      // the user:{uid} room (never a broadcast). Emitted after the
      // security-critical revoke + cache-invalidate calls above. Fire-and-
      // forget: logout success must not depend on socket teardown completing.
      const handled = this.eventEmitter.emit('auth.logout', { uid });
      if (!handled) {
        this.logger.warn(
          `auth.logout emitted but no listener handled it (uid=${uid})`,
          'AuthService',
        );
      }

      // No-op if the row doesn't exist (matches the prior exists-check).
      await this.usersRepository.setLastLogout(uid);

      return { message: 'Successfully logged out' };
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        throw new NotFoundException('User not found');
      }
      throw error;
    }
  }

  async searchUsers(
    query: string,
    limit: number = 10,
  ): Promise<SearchUserResponse> {
    // Reject blank/too-short queries (a bare query would match everyone and
    // enable user enumeration) and clamp the page size.
    const trimmedQuery = query?.trim() ?? '';
    if (trimmedQuery.length < 2) {
      throw new BadRequestException(
        'Search query must be at least 2 characters',
      );
    }
    const safeLimit = Math.min(Math.max(Math.trunc(limit) || 10, 1), 100);

    try {
      // Case-insensitive substring match over name + email (pg_trgm-backed).
      const users: SearchUserResult[] = await this.usersRepository.search(
        trimmedQuery,
        safeLimit,
      );

      return {
        users,
        total: users.length,
      };
    } catch (error) {
      console.error('User search error:', error);
      throw new InternalServerErrorException('Failed to search users');
    }
  }

  /**
   * Social sign-in / sign-up via Firebase REST accounts:signInWithIdp.
   *
   * The device obtains a provider OIDC id token through the native SDK only;
   * token issuance stays here (backend-mediated). Social login creates brand-new
   * Firebase users, so we MUST upsert the matching Postgres row (invariant A) or
   * leave an orphan UID with no profile.
   */
  async socialSignIn(dto: SocialLoginDto): Promise<AuthResponse> {
    const providerId = dto.provider === 'google' ? 'google.com' : 'apple.com';

    // Build the postBody signInWithIdp expects. For Apple we thread the RAW
    // nonce: Firebase recomputes sha256(rawNonce) and matches it against the
    // token's nonce claim (the #1 Apple failure point).
    const params = new URLSearchParams({
      id_token: dto.idToken,
      providerId,
    });
    if (dto.provider === 'apple') {
      if (!dto.nonce) {
        throw new BadRequestException('nonce is required for Apple sign-in');
      }
      params.set('nonce', dto.nonce);
    }
    const postBody = params.toString();

    let firebaseData: {
      localId: string;
      idToken: string;
      refreshToken: string;
      expiresIn: string;
      email?: string;
      displayName?: string;
    };

    try {
      const response = await axios.post(
        `${this.FIREBASE_AUTH_API}:signInWithIdp?key=${this.firebaseApiKey}`,
        {
          postBody,
          requestUri: this.firebaseAuthDomain,
          returnSecureToken: true,
          returnIdpCredential: true,
        },
      );
      firebaseData = response.data;
    } catch (error) {
      if (error.response?.data?.error) {
        const message: string | undefined = error.response.data.error.message;

        if (message?.startsWith('INVALID_IDP_RESPONSE')) {
          throw new UnauthorizedException('Invalid social sign-in credential');
        }
        if (message?.startsWith('MISSING_OR_INVALID_NONCE')) {
          throw new UnauthorizedException(
            'Invalid or missing nonce for Apple sign-in',
          );
        }
        if (message?.startsWith('FEDERATED_USER_ID_ALREADY_LINKED')) {
          throw new UnauthorizedException(
            'This social account is already linked to another user',
          );
        }
        if (message === 'USER_DISABLED') {
          throw new UnauthorizedException('This account has been disabled');
        }
        if (message) {
          throw new UnauthorizedException(
            'Social sign-in failed. Please try again',
          );
        }
      }
      throw new UnauthorizedException('Unable to complete social sign-in');
    }

    const { localId, idToken, refreshToken, expiresIn } = firebaseData;
    // Apple private-relay emails (@privaterelay.appleid.com) are valid → store
    // as-is. Google/Apple emails arrive already verified.
    const resolvedEmail = firebaseData.email ?? '';
    const resolvedDisplayName =
      dto.displayName ||
      firebaseData.displayName ||
      this.deriveDisplayName(resolvedEmail);

    // Invariant A — ensure a Postgres row exists for this Firebase UID.
    const existing = await this.usersRepository.findById(localId);

    if (!existing) {
      try {
        await this.usersRepository.create({
          id: localId,
          email: resolvedEmail,
          displayName: resolvedDisplayName,
          emailVerified: true,
          phoneVerified: false,
        });
      } catch (dbError) {
        // The Firebase user already exists by this point. Unlike register(), we
        // do NOT delete it on a DB-write failure — the user may simply retry.
        // Surface a clean 500 rather than leaking the raw DB error.
        console.error(
          `Failed to create Postgres row for social user ${localId}:`,
          dbError,
        );
        throw new InternalServerErrorException('Failed to create user profile');
      }
    } else {
      // Backfill fields the provider now supplies but the existing row lacks.
      const patch: UpdateUserInput = {};
      if (!existing.displayName && resolvedDisplayName) {
        patch.displayName = resolvedDisplayName;
      }
      if (!existing.email && resolvedEmail) {
        patch.email = resolvedEmail;
      }
      if (Object.keys(patch).length > 0) {
        await this.usersRepository.update(localId, patch);
      }
    }

    return {
      user: {
        uid: localId,
        email: resolvedEmail,
        displayName: existing?.displayName || resolvedDisplayName,
        emailVerified: true,
      },
      tokens: {
        idToken,
        refreshToken,
        expiresIn: parseInt(expiresIn),
      },
    };
  }

  // Fallback display name when the provider supplies neither a name nor (for
  // Apple after first auth) anything beyond the email.
  private deriveDisplayName(email: string): string {
    const localPart = email.split('@')[0]?.trim();
    return localPart || 'User';
  }

  /**
   * Send email verification
   */
  async sendEmailVerification(uid: string): Promise<VerificationResponse> {
    try {
      // Get user's email from Firebase Auth
      const userRecord = await this.firebaseService.auth.getUser(uid);

      if (!userRecord.email) {
        throw new Error('User does not have an email address');
      }

      // Check if user is already verified
      if (userRecord.emailVerified) {
        return {
          success: false,
          message: 'Email address is already verified',
        };
      }

      // Generate email verification link using Firebase
      const link =
        await this.firebaseService.auth.generateEmailVerificationLink(
          userRecord.email,
        );

      // Get user's display name from Postgres for personalized email
      const userData = await this.usersRepository.findById(uid);
      const displayName =
        userData?.displayName || userRecord.displayName || 'there';

      // Send email using our email service
      const emailSent = await this.emailService.sendVerificationEmail(
        userRecord.email,
        displayName,
        link,
      );

      if (emailSent) {
        return {
          success: true,
          message: 'Email verification sent successfully',
        };
      } else {
        // Fallback: log the link if email service fails
        console.log(`Email service failed. Verification link: ${link}`);
        return {
          success: true,
          message: 'Email verification initiated (check server logs for link)',
        };
      }
    } catch (error) {
      console.error('Send email verification error:', error);
      throw new Error('Failed to send email verification');
    }
  }

  /**
   * Verify email using OOB code
   */
  async verifyEmail(oobCode: string): Promise<EmailVerificationResponse> {
    try {
      // For Firebase Admin SDK, we need to use REST API for action codes
      const response = await axios.post(
        `${this.FIREBASE_AUTH_API}:update?key=${this.firebaseApiKey}`,
        {
          oobCode: oobCode,
        },
      );

      const email = response.data.email;
      if (!email) {
        throw new Error('Invalid verification code');
      }

      // Get user by email and update both Firebase Auth and Firestore
      const userRecord = await this.firebaseService.auth.getUserByEmail(email);

      // Update Firebase Auth email verification status
      await this.firebaseService.auth.updateUser(userRecord.uid, {
        emailVerified: true,
      });

      // Update the Postgres user row
      await this.usersRepository.update(userRecord.uid, {
        emailVerified: true,
      });

      return {
        success: true,
        message: 'Email verified successfully',
        emailVerified: true,
      };
    } catch (error) {
      console.error('Email verification error:', error);
      throw new Error(
        'Email verification failed. Code may be expired or invalid.',
      );
    }
  }

  /**
   * Send forgot password email
   */
  async sendPasswordReset(email: string): Promise<VerificationResponse> {
    try {
      // Check if user exists
      const userRecord = await this.firebaseService.auth.getUserByEmail(email);

      // Generate password reset link
      const link =
        await this.firebaseService.auth.generatePasswordResetLink(email);

      // Get user's display name from Postgres for personalized email
      const userData = await this.usersRepository.findById(userRecord.uid);
      const displayName =
        userData?.displayName || userRecord.displayName || 'there';

      // Send branded password reset email
      const emailSent = await this.emailService.sendPasswordResetEmail(
        email,
        displayName,
        link,
      );

      if (emailSent) {
        return {
          success: true,
          message: 'Password reset email sent successfully',
        };
      } else {
        // Fallback: log the link if email service fails
        console.log(`Email service failed. Password reset link: ${link}`);
        return {
          success: true,
          message: 'Password reset initiated (check server logs for link)',
        };
      }
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        // Return success even if user not found for security reasons
        return {
          success: true,
          message: 'If the email exists, a password reset link has been sent',
        };
      }
      console.error('Send password reset error:', error);
      throw new Error('Failed to send password reset email');
    }
  }

  /**
   * Reset password using OOB code
   */
  async resetPassword(
    oobCode: string,
    newPassword: string,
  ): Promise<VerificationResponse> {
    try {
      // Use Firebase REST API to reset password
      const response = await axios.post(
        `${this.FIREBASE_AUTH_API}:resetPassword?key=${this.firebaseApiKey}`,
        {
          oobCode: oobCode,
          newPassword: newPassword,
        },
      );

      const email = response.data.email;
      if (!email) {
        throw new Error('Invalid password reset code');
      }

      // Bump updated_at on the Postgres user row
      const userRecord = await this.firebaseService.auth.getUserByEmail(email);
      await this.usersRepository.update(userRecord.uid, {});

      return {
        success: true,
        message: 'Password reset successfully',
      };
    } catch (error) {
      console.error('Password reset error:', error);
      if (error.response?.data?.error?.message === 'EXPIRED_OOB_CODE') {
        throw new Error(
          'Password reset code has expired. Please request a new one.',
        );
      }
      if (error.response?.data?.error?.message === 'INVALID_OOB_CODE') {
        throw new Error('Invalid password reset code.');
      }
      throw new Error('Password reset failed');
    }
  }
}
