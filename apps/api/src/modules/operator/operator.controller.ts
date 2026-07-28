import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ClerkAuthGuard,
  type ClerkRequest,
} from '../../common/guards/clerk-auth.guard';
import { AddTeamMemberDto } from './dto/add-team-member.dto';
import { AssignDelegateDto } from './dto/assign-delegate.dto';
import { OperatorAccessService } from './services/operator-access.service';

@Controller('operator')
@UseGuards(ClerkAuthGuard)
export class OperatorController {
  constructor(private readonly operatorAccessService: OperatorAccessService) {}

  @Get('session')
  async getSession(@Req() request: ClerkRequest) {
    const identity = this.requireIdentity(request);
    return {
      userId: identity.userId,
      sessionId: request.clerkAuth?.sessionId ?? null,
      orgId: identity.orgId,
      orgRole: request.clerkAuth?.orgRole ?? null,
      orgSlug: request.clerkAuth?.orgSlug ?? null,
      sync: request.clerkSync ?? null,
      access: await this.operatorAccessService.getSessionAccess(
        identity.orgId,
        identity.userId,
      ),
    };
  }

  @Get('journeys')
  listJourneys(@Req() request: ClerkRequest) {
    const identity = this.requireIdentity(request);
    return this.operatorAccessService.listJourneys(
      identity.orgId,
      identity.userId,
    );
  }

  @Get('live-journeys')
  listLiveJourneyLocations(@Req() request: ClerkRequest) {
    const identity = this.requireIdentity(request);
    return this.operatorAccessService.listLiveJourneyLocations(
      identity.orgId,
      identity.userId,
    );
  }

  @Get('journeys/:journeyId/locations')
  getJourneyLocations(
    @Req() request: ClerkRequest,
    @Param('journeyId', new ParseUUIDPipe()) journeyId: string,
  ) {
    const identity = this.requireIdentity(request);
    return this.operatorAccessService.getJourneyLocations(
      identity.orgId,
      identity.userId,
      journeyId,
    );
  }

  @Get('team-members')
  listTeamMembers(@Req() request: ClerkRequest) {
    const identity = this.requireIdentity(request);
    return this.operatorAccessService.listTeamMembers(
      identity.orgId,
      identity.userId,
    );
  }

  @Get('users/search')
  searchUsers(@Req() request: ClerkRequest, @Query('q') query = '') {
    const identity = this.requireIdentity(request);
    return this.operatorAccessService.searchUsers(
      identity.orgId,
      identity.userId,
      query,
    );
  }

  @Post('team-members')
  addTeamMember(@Req() request: ClerkRequest, @Body() dto: AddTeamMemberDto) {
    const identity = this.requireIdentity(request);
    return this.operatorAccessService.addTeamMember(
      identity.orgId,
      identity.userId,
      dto.userId,
    );
  }

  @Delete('team-members/:teamMemberId')
  removeTeamMember(
    @Req() request: ClerkRequest,
    @Param('teamMemberId', new ParseUUIDPipe()) teamMemberId: string,
  ) {
    const identity = this.requireIdentity(request);
    return this.operatorAccessService.removeTeamMember(
      identity.orgId,
      identity.userId,
      teamMemberId,
    );
  }

  @Post('team-members/:teamMemberId/delegates')
  assignDelegate(
    @Req() request: ClerkRequest,
    @Param('teamMemberId', new ParseUUIDPipe()) teamMemberId: string,
    @Body() dto: AssignDelegateDto,
  ) {
    const identity = this.requireIdentity(request);
    return this.operatorAccessService.assignDelegate(
      identity.orgId,
      identity.userId,
      teamMemberId,
      dto.clerkUserId,
    );
  }

  @Delete('team-members/:teamMemberId/delegates/:clerkUserId')
  removeDelegate(
    @Req() request: ClerkRequest,
    @Param('teamMemberId', new ParseUUIDPipe()) teamMemberId: string,
    @Param('clerkUserId') clerkUserId: string,
  ) {
    const identity = this.requireIdentity(request);
    return this.operatorAccessService.removeDelegate(
      identity.orgId,
      identity.userId,
      teamMemberId,
      clerkUserId,
    );
  }

  private requireIdentity(request: ClerkRequest) {
    const userId = request.clerkAuth?.userId;
    const orgId = request.clerkAuth?.orgId;
    if (!userId || !orgId) {
      throw new UnauthorizedException('Active Clerk organization required');
    }
    return { userId, orgId };
  }
}
