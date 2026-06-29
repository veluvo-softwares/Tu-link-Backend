import {
  Controller,
  Post,
  Get,
  Put,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  BadRequestException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { SocialLoginDto } from './dto/social-login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register a new user',
    description: `Register a new user account and receive authentication tokens.

**Phone Number Format:** Must be in E.164 format (e.g., +254712345678, +1234567890)

**Email Verification:** A verification email is automatically sent to the user's email address after successful registration.

**Returns:**
- User profile data
- Firebase ID token (valid for 1 hour)
- Refresh token
- Token expiration time`,
  })
  @ApiResponse({
    status: 201,
    description: 'User successfully registered. Returns user data with tokens.',
  })
  @ApiResponse({
    status: 409,
    description: 'Email or phone number already in use',
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error - check phone number format (E.164)',
  })
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login with email and password',
    description: `Authenticate with existing credentials and receive tokens.

**Returns:**
- User profile data
- Firebase ID token (valid for 1 hour)
- Refresh token
- Token expiration time`,
  })
  @ApiResponse({
    status: 200,
    description: 'Login successful. Returns user data with tokens.',
  })
  @ApiResponse({ status: 401, description: 'Invalid email or password' })
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('guest-sign-in')
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign in as a guest using Firebase Anonymous Authentication',
    description: `Creates an anonymous Firebase session without requiring email or password.
Each call creates a distinct anonymous Firebase user (no session/user reuse).

Returns a valid Firebase ID token that is accepted by FirebaseAuthGuard on all protected endpoints.
No persistent user document is created; the anonymous account is deleted on logout.`,
  })
  @ApiResponse({
    status: 200,
    description:
      'Guest sign-in successful. Returns anonymous user data with tokens.',
  })
  @ApiResponse({ status: 401, description: 'Guest sign-in failed' })
  async guestSignIn() {
    return this.authService.guestSignIn();
  }

  @Post('social')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign in / sign up with a social provider (Google or Apple)',
    description: `Exchange a provider OIDC id token (obtained on-device via the
native Google/Apple SDK) for a standard Tu-Link session via Firebase
\`accounts:signInWithIdp\`. Backend-mediated: the client never mints Firebase
tokens. On first social sign-in a matching Postgres user row is created
(invariant A).

**Body:**
- \`provider\`: \`'google'\` or \`'apple'\`
- \`idToken\`: provider OIDC id token
- \`nonce\`: raw (unhashed) nonce — **required for Apple**
- \`displayName\` (optional): Apple supplies the name only on first auth, so the
  client forwards it here

**Returns:**
- User profile data
- Firebase ID token (valid for 1 hour)
- Refresh token
- Token expiration time`,
  })
  @ApiResponse({
    status: 200,
    description: 'Social sign-in successful. Returns user data with tokens.',
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid provider credential or nonce',
  })
  async social(@Body() socialLoginDto: SocialLoginDto) {
    return this.authService.socialSignIn(socialLoginDto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Refresh authentication token',
    description: `Get a new ID token before the current one expires (1 hour).

**Requires:** Valid refresh token in request body`,
  })
  @ApiResponse({
    status: 200,
    description: 'Token refreshed successfully. Returns new ID token.',
  })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  async refresh(@Body() refreshTokenDto: { refreshToken?: string }) {
    if (!refreshTokenDto?.refreshToken) {
      throw new BadRequestException('refreshToken is required');
    }
    return this.authService.refreshToken(refreshTokenDto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(FirebaseAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Logout and revoke all tokens',
    description: `Revoke all refresh tokens for the current user. Existing ID tokens will become invalid.

**Note:** All active sessions will be terminated. User must login again to get new tokens.`,
  })
  @ApiResponse({
    status: 200,
    description: 'Logout successful. All tokens revoked.',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or expired token',
  })
  async logout(
    @CurrentUser('uid') uid: string,
    @CurrentUser('isGuest') isGuest: boolean,
  ) {
    return this.authService.logout(uid, isGuest);
  }

  @Get('profile')
  @UseGuards(FirebaseAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Get current user profile',
    description: `Retrieve the authenticated user's profile information.

**Returns:**
- User ID
- Email
- Display name
- Phone number
- Account creation date
- Last update date`,
  })
  @ApiResponse({ status: 200, description: 'Profile retrieved successfully' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or expired token',
  })
  @ApiResponse({ status: 404, description: 'User profile not found' })
  async getProfile(@CurrentUser('uid') uid: string) {
    return this.authService.getProfile(uid);
  }

  @Put('profile')
  @UseGuards(FirebaseAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Update user profile',
    description: `Update the authenticated user's profile information.

**Updatable Fields:**
- Display name
- Phone number (must be in E.164 format)

**Returns:** Updated user profile with new \`updatedAt\` timestamp`,
  })
  @ApiResponse({
    status: 200,
    description:
      'Profile updated successfully. Returns updated profile with updatedAt timestamp.',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or expired token',
  })
  @ApiResponse({ status: 404, description: 'User profile not found' })
  @ApiResponse({
    status: 400,
    description: 'Validation error - check phone number format (E.164)',
  })
  async updateProfile(
    @CurrentUser('uid') uid: string,
    @Body() updateProfileDto: UpdateProfileDto,
  ) {
    return this.authService.updateProfile(uid, updateProfileDto);
  }

  @Get('searchUser')
  @UseGuards(FirebaseAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Search users by display name or email',
    description: `Search for users to invite to journeys. Returns matching users based on display name or email.
    
**Search Features:**
- Case-insensitive search
- Searches both display name and email fields
- Returns multiple users for common names (e.g., wesley nyamu, wesley muriithi)
- Minimum query length: 2 characters
- Default limit: 10 users

**Use Cases:**
- Finding users to invite to journeys
- User discovery for convoy formation
- Contact search functionality`,
  })
  @ApiResponse({
    status: 200,
    description:
      'Search completed successfully. Returns array of matching users.',
    schema: {
      type: 'object',
      properties: {
        users: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              uid: { type: 'string', description: 'User Firebase UID' },
              email: { type: 'string', description: 'User email address' },
              displayName: { type: 'string', description: 'User display name' },
              phoneNumber: {
                type: 'string',
                description: 'User phone number',
                nullable: true,
              },
            },
          },
        },
        total: { type: 'number', description: 'Number of users found' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Query too short (minimum 2 characters)',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or expired token',
  })
  async searchUser(
    @Query('query') query: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.authService.searchUsers(query, limit || 10);
  }

  @Post('send-email-verification')
  @UseGuards(FirebaseAuthGuard)
  @ApiBearerAuth('bearer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send email verification',
    description: `Send email verification link to user's registered email address.
    
**Important Notes:**
- User must be authenticated
- Returns error if email is already verified
- Email verification link is sent to the user's registered email
- Link expires after 1 hour
- Can be called multiple times if needed (for unverified emails)`,
  })
  @ApiResponse({
    status: 200,
    description:
      'Email verification sent successfully or email already verified',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or expired token',
  })
  @ApiResponse({
    status: 400,
    description: 'User does not have an email address',
  })
  async sendEmailVerification(@CurrentUser('uid') uid: string) {
    return this.authService.sendEmailVerification(uid);
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify email address',
    description: `Verify user email address using the OOB code from verification email.
    
**Process:**
1. User clicks verification link in email
2. Extract OOB code from URL
3. Submit code to this endpoint
4. Email becomes verified in user profile`,
  })
  @ApiResponse({
    status: 200,
    description: 'Email verified successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        emailVerified: { type: 'boolean' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid or expired verification code',
  })
  async verifyEmail(@Body() verifyEmailDto: VerifyEmailDto) {
    return this.authService.verifyEmail(verifyEmailDto.oobCode);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send password reset email',
    description: `Send password reset link to user's email address.
    
**Security Features:**
- Returns success even for non-existent emails (prevents user enumeration)
- Password reset link expires after 1 hour
- Previous reset links are invalidated when new one is generated`,
  })
  @ApiResponse({
    status: 200,
    description: 'Password reset email sent (or would be sent if email exists)',
  })
  @ApiResponse({ status: 400, description: 'Invalid email format' })
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.sendPasswordReset(forgotPasswordDto.email);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reset password using OOB code',
    description: `Reset user password using OOB code from password reset email.
    
**Process:**
1. User clicks password reset link in email
2. Extract OOB code from URL
3. User enters new password
4. Submit code and new password to this endpoint`,
  })
  @ApiResponse({ status: 200, description: 'Password reset successfully' })
  @ApiResponse({
    status: 400,
    description: 'Invalid, expired, or already used reset code',
  })
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(
      resetPasswordDto.oobCode,
      resetPasswordDto.newPassword,
    );
  }
}
