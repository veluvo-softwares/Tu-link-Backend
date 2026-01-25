import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
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
import { JourneyService } from './journey.service';
import { ParticipantService } from './services/participant.service';
import { CreateJourneyDto } from './dto/create-journey.dto';
import { UpdateJourneyDto } from './dto/update-journey.dto';
import { InviteParticipantByIdDto } from './dto/invite-participant.dto';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('journeys')
@ApiBearerAuth()
@Controller('journeys')
@UseGuards(FirebaseAuthGuard)
export class JourneyController {
  constructor(
    private journeyService: JourneyService,
    private participantService: ParticipantService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new journey',
    description:
      'Create a new journey with PENDING status. The authenticated user becomes the leader.',
  })
  @ApiResponse({ status: 201, description: 'Journey created successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async create(
    @CurrentUser('uid') userId: string,
    @Body() createJourneyDto: CreateJourneyDto,
  ) {
    return this.journeyService.create(userId, createJourneyDto);
  }

  @Get('active')
  @ApiOperation({ summary: 'Get user active journeys' })
  @ApiResponse({
    status: 200,
    description: 'Active journeys retrieved successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getActiveJourneys(@CurrentUser('uid') userId: string) {
    return this.journeyService.getUserActiveJourneys(userId);
  }

  @Get('invitations')
  @ApiOperation({ summary: 'Get user pending journey invitations' })
  @ApiResponse({
    status: 200,
    description: 'Invitations retrieved successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getPendingInvitations(@CurrentUser('uid') userId: string) {
    return this.journeyService.getUserPendingInvitations(userId);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get journey details',
    description:
      'Get detailed information about a journey including all participants. User must be a participant.',
  })
  @ApiResponse({
    status: 200,
    description: 'Journey details retrieved successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Not a participant of this journey',
  })
  @ApiResponse({ status: 404, description: 'Journey not found' })
  async getJourney(
    @Param('id') id: string,
    @CurrentUser('uid') userId: string,
  ) {
    return this.journeyService.getJourneyWithParticipants(id, userId);
  }

  @Put(':id')
  @ApiOperation({
    summary: 'Update journey',
    description:
      'Update journey details. Only the leader can update. Can only update PENDING journeys.',
  })
  @ApiResponse({ status: 200, description: 'Journey updated successfully' })
  @ApiResponse({ status: 400, description: 'Can only update pending journeys' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Only leader can update journey' })
  @ApiResponse({ status: 404, description: 'Journey not found' })
  async update(
    @Param('id') id: string,
    @CurrentUser('uid') userId: string,
    @Body() updateJourneyDto: UpdateJourneyDto,
  ) {
    return this.journeyService.update(id, userId, updateJourneyDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Cancel journey',
    description:
      'Cancel a journey. Only the leader can cancel. Cannot cancel active journeys.',
  })
  @ApiResponse({ status: 204, description: 'Journey cancelled successfully' })
  @ApiResponse({ status: 400, description: 'Cannot delete active journey' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Only leader can delete journey' })
  @ApiResponse({ status: 404, description: 'Journey not found' })
  async delete(@Param('id') id: string, @CurrentUser('uid') userId: string) {
    await this.journeyService.delete(id, userId);
  }

  @Post(':id/start')
  @ApiOperation({
    summary: 'Start journey',
    description:
      'Start the journey, changing status from PENDING to ACTIVE. All ACCEPTED participants become ACTIVE. Only the leader can start.',
  })
  @ApiResponse({ status: 200, description: 'Journey started successfully' })
  @ApiResponse({
    status: 400,
    description: 'Journey already started or completed',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Only leader can start journey' })
  @ApiResponse({ status: 404, description: 'Journey not found' })
  async start(@Param('id') id: string, @CurrentUser('uid') userId: string) {
    return this.journeyService.start(id, userId);
  }

  @Post(':id/end')
  @ApiOperation({
    summary: 'End journey',
    description:
      'End the journey, changing status from ACTIVE to COMPLETED. Only the leader can end.',
  })
  @ApiResponse({ status: 200, description: 'Journey ended successfully' })
  @ApiResponse({ status: 400, description: 'Journey is not active' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Only leader can end journey' })
  @ApiResponse({ status: 404, description: 'Journey not found' })
  async end(@Param('id') id: string, @CurrentUser('uid') userId: string) {
    return this.journeyService.end(id, userId);
  }

  @Get(':id/participants')
  @ApiOperation({
    summary: 'Get journey participants',
    description:
      'Get all participants in a journey with their status and details.',
  })
  @ApiResponse({
    status: 200,
    description: 'Participants retrieved successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Journey not found' })
  async getParticipants(@Param('id') id: string) {
    return this.participantService.getJourneyParticipants(id);
  }

  @Post(':id/invite')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Invite participant to journey',
    description:
      'Invite a user to join the journey. Only the leader can invite. Journey must be PENDING. Creates a notification for the invited user.',
  })
  @ApiResponse({ status: 201, description: 'Invitation sent successfully' })
  @ApiResponse({
    status: 400,
    description:
      'Can only invite to pending journeys OR User already invited/participating OR Cannot invite yourself',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Only leader can invite participants',
  })
  @ApiResponse({
    status: 404,
    description: 'Journey not found OR Invited user not found',
  })
  async invite(
    @Param('id') id: string,
    @CurrentUser('uid') userId: string,
    @Body() inviteDto: InviteParticipantByIdDto,
  ) {
    await this.journeyService.inviteParticipant(
      id,
      userId,
      inviteDto.invitedUserId,
    );
    return { message: 'Invitation sent successfully' };
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept journey invitation',
    description:
      'Accept an invitation to join a journey. Changes participant status from INVITED to ACCEPTED. Sets joinedAt timestamp.',
  })
  @ApiResponse({ status: 200, description: 'Invitation accepted successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 404,
    description: 'Journey not found OR Invitation not found',
  })
  async accept(@Param('id') id: string, @CurrentUser('uid') userId: string) {
    await this.participantService.acceptInvitation(id, userId);
    return { message: 'Invitation accepted' };
  }

  @Post(':id/decline')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Decline journey invitation',
    description:
      'Decline an invitation to join a journey. Changes participant status from INVITED to DECLINED.',
  })
  @ApiResponse({ status: 200, description: 'Invitation declined successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 404,
    description: 'Journey not found OR Invitation not found',
  })
  async decline(@Param('id') id: string, @CurrentUser('uid') userId: string) {
    await this.participantService.declineInvitation(id, userId);
    return { message: 'Invitation declined' };
  }

  @Post(':id/leave')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Leave journey',
    description:
      'Leave an active journey. Changes participant status to LEFT. Cannot leave if you are the leader.',
  })
  @ApiResponse({ status: 200, description: 'Left journey successfully' })
  @ApiResponse({
    status: 400,
    description: 'Cannot leave - journey requirements not met',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 404,
    description: 'Journey not found OR Not a participant',
  })
  async leave(@Param('id') id: string, @CurrentUser('uid') userId: string) {
    await this.participantService.leaveJourney(id, userId);
    return { message: 'Left journey successfully' };
  }
}
