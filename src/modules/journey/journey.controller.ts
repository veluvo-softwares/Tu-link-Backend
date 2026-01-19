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
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
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
  async create(
    @CurrentUser('uid') userId: string,
    @Body() createJourneyDto: CreateJourneyDto,
  ) {
    return this.journeyService.create(userId, createJourneyDto);
  }

  @Get('active')
  @ApiOperation({ summary: 'Get user active journeys' })
  @ApiResponse({ status: 200, description: 'Active journeys retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getActiveJourneys(@CurrentUser('uid') userId: string) {
    return this.journeyService.getUserActiveJourneys(userId);
  }

  @Get('invitations')
  @ApiOperation({ summary: 'Get user pending journey invitations' })
  @ApiResponse({ status: 200, description: 'Invitations retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getPendingInvitations(@CurrentUser('uid') userId: string) {
    return this.journeyService.getUserPendingInvitations(userId);
  }

  @Get(':id')
  async getJourney(@Param('id') id: string, @CurrentUser('uid') userId: string) {
    return this.journeyService.getJourneyWithParticipants(id, userId);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @CurrentUser('uid') userId: string,
    @Body() updateJourneyDto: UpdateJourneyDto,
  ) {
    return this.journeyService.update(id, userId, updateJourneyDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string, @CurrentUser('uid') userId: string) {
    await this.journeyService.delete(id, userId);
  }

  @Post(':id/start')
  async start(@Param('id') id: string, @CurrentUser('uid') userId: string) {
    return this.journeyService.start(id, userId);
  }

  @Post(':id/end')
  async end(@Param('id') id: string, @CurrentUser('uid') userId: string) {
    return this.journeyService.end(id, userId);
  }

  @Get(':id/participants')
  async getParticipants(@Param('id') id: string) {
    return this.participantService.getJourneyParticipants(id);
  }

  @Post(':id/invite')
  @HttpCode(HttpStatus.CREATED)
  async invite(
    @Param('id') id: string,
    @CurrentUser('uid') userId: string,
    @Body() inviteDto: InviteParticipantByIdDto,
  ) {
    await this.journeyService.inviteParticipant(id, userId, inviteDto.invitedUserId);
    return { message: 'Invitation sent successfully' };
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  async accept(@Param('id') id: string, @CurrentUser('uid') userId: string) {
    await this.participantService.acceptInvitation(id, userId);
    return { message: 'Invitation accepted' };
  }

  @Post(':id/decline')
  @HttpCode(HttpStatus.OK)
  async decline(@Param('id') id: string, @CurrentUser('uid') userId: string) {
    await this.participantService.declineInvitation(id, userId);
    return { message: 'Invitation declined' };
  }

  @Post(':id/leave')
  @HttpCode(HttpStatus.OK)
  async leave(@Param('id') id: string, @CurrentUser('uid') userId: string) {
    await this.participantService.leaveJourney(id, userId);
    return { message: 'Left journey successfully' };
  }
}
