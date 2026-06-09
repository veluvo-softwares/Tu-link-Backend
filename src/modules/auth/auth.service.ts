/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
  Injectable,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebaseService } from '../../shared/firebase/firebase.service';
import { TuLinkResendEmailService } from '../../shared/email/tulink-resend-email.service';
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
import { FieldValue } from 'firebase-admin/firestore';
import { convertCommonTimestamps } from '../../common/utils/date.utils';
import axios from 'axios';

@Injectable()
export class AuthService {
  private readonly FIREBASE_AUTH_API =
    'https://identitytoolkit.googleapis.com/v1/accounts';
  private readonly firebaseApiKey: string;

  constructor(
    private firebaseService: FirebaseService,
    private configService: ConfigService,
    private emailService: TuLinkResendEmailService,
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

      // Create Firestore user document
      interface UserData {
        email: string;
        displayName: string;
        emailVerified: boolean;
        phoneVerified: boolean;
        createdAt: ReturnType<typeof FieldValue.serverTimestamp>;
        updatedAt: ReturnType<typeof FieldValue.serverTimestamp>;
        phoneNumber?: string;
      }

      const userData: UserData = {
        email: registerDto.email,
        displayName: registerDto.displayName,
        emailVerified: false,
        phoneVerified: false,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };

      // Only add phoneNumber to Firestore if provided
      if (registerDto.phoneNumber) {
        userData.phoneNumber = registerDto.phoneNumber;
      }

      await this.firebaseService.firestore
        .collection('users')
        .doc(userRecord.uid)
        .set(userData);

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

      // Get user data from Firestore
      const userDoc = await this.firebaseService.firestore
        .collection('users')
        .doc(localId)
        .get();

      if (!userDoc.exists) {
        throw new NotFoundException('User profile not found');
      }

      const userData = userDoc.data() as
        | {
            displayName?: string;
            phoneNumber?: string;
            emailVerified?: boolean;
          }
        | undefined;

      // Sync email verification status between Firebase Auth and Firestore
      const authEmailVerified = firebaseUser.emailVerified;
      const firestoreEmailVerified = userData?.emailVerified || false;

      if (authEmailVerified !== firestoreEmailVerified) {
        console.log(
          `Syncing email verification status: Firebase Auth=${authEmailVerified}, Firestore=${firestoreEmailVerified}`,
        );

        // Update Firestore to match Firebase Auth
        await this.firebaseService.firestore
          .collection('users')
          .doc(localId)
          .update({
            emailVerified: authEmailVerified,
            updatedAt: FieldValue.serverTimestamp(),
          });
      }

      // Return the ID token and refresh token from Firebase
      return {
        user: {
          uid: localId,
          email: email,
          displayName: userData?.displayName || '',
          phoneNumber: userData?.phoneNumber,
          emailVerified: authEmailVerified, // Use Firebase Auth as source of truth
        },
        tokens: {
          idToken,
          refreshToken,
          expiresIn: parseInt(expiresIn),
        },
      };
    } catch (error) {
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

    const userDoc = await this.firebaseService.firestore
      .collection('users')
      .doc(uid)
      .get();

    if (!userDoc.exists) {
      throw new NotFoundException('User not found');
    }

    const userData = { id: userDoc.id, ...userDoc.data() } as User;

    // Sync email verification status if needed
    const authEmailVerified = firebaseUser.emailVerified;
    const firestoreEmailVerified = userData.emailVerified || false;

    if (authEmailVerified !== firestoreEmailVerified) {
      console.log(
        `Syncing profile email verification: Firebase Auth=${authEmailVerified}, Firestore=${firestoreEmailVerified}`,
      );

      // Update Firestore
      await this.firebaseService.firestore.collection('users').doc(uid).update({
        emailVerified: authEmailVerified,
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Update local userData
      userData.emailVerified = authEmailVerified;
    }

    // Convert Firestore Timestamps to ISO 8601 strings
    return convertCommonTimestamps(
      userData as unknown as Record<string, unknown>,
    ) as unknown as User;
  }

  async updateProfile(
    uid: string,
    updateProfileDto: UpdateProfileDto,
  ): Promise<User> {
    const updateData: any = {
      ...updateProfileDto,
      updatedAt: FieldValue.serverTimestamp(),
    };

    // Update Firebase Auth
    await this.firebaseService.auth.updateUser(uid, updateProfileDto);

    // Update Firestore
    await this.firebaseService.firestore
      .collection('users')
      .doc(uid)
      .update(updateData);

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

  async logout(uid: string): Promise<{ message: string }> {
    try {
      // Revoke all refresh tokens for the user
      await this.firebaseService.auth.revokeRefreshTokens(uid);

      // Update user metadata to track the revocation time
      const userDoc = await this.firebaseService.firestore
        .collection('users')
        .doc(uid)
        .get();

      if (userDoc.exists) {
        await this.firebaseService.firestore
          .collection('users')
          .doc(uid)

          .update({
            lastLogout: FieldValue.serverTimestamp(),
          });
      }

      return {
        message: 'Successfully logged out',
      };
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
    try {
      const normalizedQuery = query.toLowerCase().trim();

      // Search by display name (case-insensitive)
      const displayNameQuery = this.firebaseService.firestore
        .collection('users')
        .where('displayName', '>=', query)
        .where('displayName', '<=', query + '\uf8ff')
        .limit(limit);

      // Search by email (case-insensitive)
      const emailQuery = this.firebaseService.firestore
        .collection('users')
        .where('email', '>=', normalizedQuery)
        .where('email', '<=', normalizedQuery + '\uf8ff')
        .limit(limit);

      // Execute both queries in parallel
      const [displayNameSnapshot, emailSnapshot] = await Promise.all([
        displayNameQuery.get(),
        emailQuery.get(),
      ]);

      // Combine results and remove duplicates
      const userMap = new Map<string, SearchUserResult>();

      // Process display name results
      displayNameSnapshot.docs.forEach((doc) => {
        const data = doc.data();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        if (data.displayName?.toLowerCase().includes(normalizedQuery)) {
          userMap.set(doc.id, {
            uid: doc.id,

            email: (data.email as string) || '',

            displayName: (data.displayName as string) || '',

            phoneNumber: data.phoneNumber as string,
          });
        }
      });

      // Process email results
      emailSnapshot.docs.forEach((doc) => {
        const data = doc.data();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        if (data.email?.toLowerCase().includes(normalizedQuery)) {
          userMap.set(doc.id, {
            uid: doc.id,

            email: (data.email as string) || '',

            displayName: (data.displayName as string) || '',

            phoneNumber: data.phoneNumber as string,
          });
        }
      });

      // Convert to array and apply limit
      const users = Array.from(userMap.values()).slice(0, limit);

      return {
        users,
        total: users.length,
      };
    } catch (error) {
      console.error('User search error:', error);
      throw new Error('Failed to search users');
    }
  }

  async guestSignIn(): Promise<AuthResponse> {
    try {
      // Call Firebase REST API for anonymous sign-in (signUp with no email/password)
      const response = await axios.post(
        `${this.FIREBASE_AUTH_API}:signUp?key=${this.firebaseApiKey}`,
        {
          returnSecureToken: true,
        },
      );

      const { localId, idToken, refreshToken, expiresIn } = response.data as {
        localId: string;
        idToken: string;
        refreshToken: string;
        expiresIn: string;
      };

      // Create Firestore document for the anonymous user
      await this.firebaseService.firestore.collection('users').doc(localId).set(
        {
          displayName: 'Guest',
          email: '',
          emailVerified: false,
          phoneVerified: false,
          isGuest: true,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

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

      // Get user's display name from Firestore for personalized email
      const userDoc = await this.firebaseService.firestore
        .collection('users')
        .doc(uid)
        .get();

      const userData = userDoc.data();
      const displayName = userData?.displayName || userRecord.displayName;

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

      // Update Firestore
      await this.firebaseService.firestore
        .collection('users')
        .doc(userRecord.uid)
        .update({
          emailVerified: true,
          updatedAt: FieldValue.serverTimestamp(),
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

      // Get user's display name from Firestore for personalized email
      const userDoc = await this.firebaseService.firestore
        .collection('users')
        .doc(userRecord.uid)
        .get();

      const userData = userDoc.data();
      const displayName = userData?.displayName || userRecord.displayName;

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

      // Update timestamp in Firestore
      const userRecord = await this.firebaseService.auth.getUserByEmail(email);
      await this.firebaseService.firestore
        .collection('users')
        .doc(userRecord.uid)
        .update({
          updatedAt: FieldValue.serverTimestamp(),
        });

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
