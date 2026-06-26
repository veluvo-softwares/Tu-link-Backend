/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
  Injectable,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebaseService } from '../../shared/firebase/firebase.service';
import { UsersRepository } from '../../database/repositories/users.repository';
import { TuLinkResendEmailService } from '../../shared/email/tulink-resend-email.service';
import { RedisService } from '../../shared/redis/redis.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
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

  constructor(
    private firebaseService: FirebaseService,
    private usersRepository: UsersRepository,
    private configService: ConfigService,
    private emailService: TuLinkResendEmailService,
    private redisService: RedisService,
  ) {
    this.firebaseApiKey =
      this.configService.get<string>('firebase.apiKey') || '';
    if (!this.firebaseApiKey) {
      throw new Error('Firebase API Key is not configured');
    }
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
      if (
        (error as { response?: { data?: { error?: { message?: string } } } })
          .response?.data?.error
      ) {
        const firebaseError = (
          error as { response: { data: { error: { message?: string } } } }
        ).response.data.error;

        if (
          firebaseError.message === 'TOKEN_EXPIRED' ||
          firebaseError.message === 'INVALID_REFRESH_TOKEN'
        ) {
          throw new UnauthorizedException(
            'Refresh token expired or invalid. Please login again.',
          );
        }
      }
      throw new UnauthorizedException('Failed to refresh token');
    }
  }

  async logout(uid: string, isGuest = false): Promise<{ message: string }> {
    try {
      if (isGuest) {
        // Delete the anonymous account entirely — nothing to preserve
        await this.firebaseService.auth.deleteUser(uid);
        return { message: 'Successfully logged out' };
      }

      await this.firebaseService.auth.revokeRefreshTokens(uid);

      await this.redisService.invalidateRevocationCache(uid);

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

  async guestSignIn(): Promise<AuthResponse> {
    try {
      const response = await axios.post(
        `${this.FIREBASE_AUTH_API}:signUp?key=${this.firebaseApiKey}`,
        { returnSecureToken: true },
        { timeout: 8000 },
      );

      const { localId, idToken, refreshToken, expiresIn } = response.data as {
        localId: string;
        idToken: string;
        refreshToken: string;
        expiresIn: string;
      };

      return {
        user: {
          uid: localId,
          email: '',
          displayName: 'Guest',
          emailVerified: false,
        },
        tokens: {
          idToken,
          refreshToken,
          expiresIn: parseInt(expiresIn),
        },
      };
    } catch (error) {
      console.error('Guest sign-in error:', error);
      throw new UnauthorizedException('Guest sign-in failed');
    }
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
