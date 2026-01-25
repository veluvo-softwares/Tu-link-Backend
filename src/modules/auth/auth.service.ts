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
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { User } from '../../shared/interfaces/user.interface';
import { AuthResponse } from './interfaces/auth-response.interface';
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
        createdAt: ReturnType<typeof FieldValue.serverTimestamp>;
        updatedAt: ReturnType<typeof FieldValue.serverTimestamp>;
        phoneNumber?: string;
      }

      const userData: UserData = {
        email: registerDto.email,
        displayName: registerDto.displayName,
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

      // Get user data from Firestore
      const userDoc = await this.firebaseService.firestore
        .collection('users')
        .doc(localId)
        .get();

      if (!userDoc.exists) {
        throw new NotFoundException('User profile not found');
      }

      const userData = userDoc.data() as
        | { displayName?: string; phoneNumber?: string }
        | undefined;

      // Return the ID token and refresh token from Firebase
      return {
        user: {
          uid: localId,
          email: email,
          displayName: userData?.displayName || '',
          phoneNumber: userData?.phoneNumber,

          emailVerified:
            (response.data as { emailVerified?: boolean }).emailVerified ||
            false,
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
      }

      throw new UnauthorizedException('Authentication failed');
    }
  }

  async getProfile(uid: string): Promise<User> {
    const userDoc = await this.firebaseService.firestore
      .collection('users')
      .doc(uid)
      .get();

    if (!userDoc.exists) {
      throw new NotFoundException('User not found');
    }

    const userData = { id: userDoc.id, ...userDoc.data() } as User;

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
}
