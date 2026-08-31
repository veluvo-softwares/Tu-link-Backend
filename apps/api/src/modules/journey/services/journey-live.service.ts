import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JourneyRouteRepository } from '../../../database/repositories/journey-route.repository';
import { JourneyRepository } from '../../../database/repositories/journey.repository';
import { LocationService } from '../../location/location.service';
import { ParticipantService } from './participant.service';

export type LocationFreshness = 'LIVE' | 'DELAYED' | 'STALE' | 'UNKNOWN';

const LIVE_LOCATION_MAX_AGE_SECONDS = 15;
const DELAYED_LOCATION_MAX_AGE_SECONDS = 60;

@Injectable()
export class JourneyLiveService {
  constructor(
    private readonly journeyRepository: JourneyRepository,
    private readonly participantService: ParticipantService,
    private readonly locationService: LocationService,
    private readonly routeRepository: JourneyRouteRepository,
  ) {}

  async getSnapshot(journeyId: string, userId: string) {
    const journey = await this.journeyRepository.findById(journeyId);
    if (!journey) throw new NotFoundException('Journey not found');

    const isParticipant = await this.participantService.isParticipant(
      journeyId,
      userId,
    );
    if (!isParticipant) {
      throw new ForbiddenException('Not a participant of this journey');
    }

    const [participants, latest, route] = await Promise.all([
      this.participantService.getJourneyParticipants(journeyId),
      this.locationService.getLatestLocationsForAuthorizedViewer(journeyId),
      this.routeRepository.findCurrent(journeyId),
    ]);
    const now = Date.now();
    const visibleParticipants = participants.filter(
      (participant) =>
        participant.role === 'LEADER' ||
        ['ACTIVE', 'ACCEPTED', 'ARRIVED'].includes(participant.status),
    );
    const members = visibleParticipants.map((participant) => {
      const location = latest.participants[participant.userId] ?? null;
      const recordedAt = location
        ? (location.positionRecordedAt ?? location.timestamp)
        : null;
      const locationAgeSeconds =
        recordedAt == null ? null : Math.max(0, (now - recordedAt) / 1000);

      return {
        userId: participant.userId,
        displayName: participant.displayName,
        role: participant.role,
        status: participant.status,
        connectionStatus: participant.connectionStatus,
        lastSeenAt: participant.lastSeenAt ?? null,
        arrivedAt: participant.arrivedAt ?? null,
        location,
        lastLocationAt:
          recordedAt == null ? null : new Date(recordedAt).toISOString(),
        locationAgeSeconds,
        locationState: this.locationFreshness(locationAgeSeconds),
      };
    });
    const locationSequence = members.reduce(
      (highest, member) =>
        Math.max(highest, member.location?.sequenceNumber ?? 0),
      0,
    );

    return {
      journey: {
        id: journey.id,
        name: journey.name,
        leaderId: journey.leaderId,
        status: journey.status,
        destination: journey.destination,
        destinationName: journey.destinationName,
        destinationAddress: journey.destinationAddress,
        startTime: journey.startTime,
        endTime: journey.endTime,
        lagThresholdMeters: journey.lagThresholdMeters,
      },
      route,
      members,
      cursor: { locationSequence },
      generatedAt: new Date(now).toISOString(),
    };
  }

  private locationFreshness(ageSeconds: number | null): LocationFreshness {
    if (ageSeconds == null) return 'UNKNOWN';
    if (ageSeconds <= LIVE_LOCATION_MAX_AGE_SECONDS) return 'LIVE';
    if (ageSeconds <= DELAYED_LOCATION_MAX_AGE_SECONDS) return 'DELAYED';
    return 'STALE';
  }
}
