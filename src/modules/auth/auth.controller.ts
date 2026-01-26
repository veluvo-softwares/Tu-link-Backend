import {
  Controller,
  Post,
  Get,
  Put,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
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
  async refresh(@Body() refreshTokenDto: { refreshToken: string }) {
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
  async logout(@CurrentUser('uid') uid: string) {
    return this.authService.logout(uid);
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
}
