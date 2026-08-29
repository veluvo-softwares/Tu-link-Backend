import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  JourneyRouteRecord,
  JourneyRouteRepository,
  JourneyRouteVersionConflictError,
} from '../../../database/repositories/journey-route.repository';
import { JourneyRepository } from '../../../database/repositories/journey.repository';
import { MapsService } from '../../maps/services/maps.service';
import { UpsertJourneyRouteDto } from '../dto/upsert-journey-route.dto';
import { ParticipantService } from './participant.service';

@Injectable()
export class JourneyRouteService {
  constructor(
    private readonly routeRepository: JourneyRouteRepository,
    private readonly journeyRepository: JourneyRepository,
    private readonly participantService: ParticipantService,
    private readonly mapsService: MapsService,
  ) {}

  async getCurrent(
    journeyId: string,
    userId: string,
  ): Promise<JourneyRouteRecord | null> {
    const journey = await this.journeyRepository.findById(journeyId);
    if (!journey) throw new NotFoundException('Journey not found');

    const isParticipant = await this.participantService.isParticipant(
      journeyId,
      userId,
    );
    if (!isParticipant) {
      throw new ForbiddenException('Not a participant of this journey');
    }

    return this.routeRepository.findCurrent(journeyId);
  }

  async replaceCurrent(
    journeyId: string,
    userId: string,
    dto: UpsertJourneyRouteDto,
  ): Promise<JourneyRouteRecord> {
    const journey = await this.journeyRepository.findById(journeyId);
    if (!journey) throw new NotFoundException('Journey not found');
    if (journey.leaderId !== userId) {
      throw new ForbiddenException(
        'Only the leader can update the canonical route',
      );
    }
    if (journey.status !== 'ACTIVE') {
      throw new BadRequestException(
        'Canonical routes can only be updated for active journeys',
      );
    }
    if (!journey.destination) {
      throw new BadRequestException('Journey has no destination');
    }

    // Return a committed result before checking baseVersion or calling Mapbox:
    // a retry whose first response was lost must not create a new route.
    const duplicate = await this.routeRepository.findByRequestId(
      journeyId,
      dto.requestId,
    );
    if (duplicate) return duplicate;

    const current = await this.routeRepository.findCurrent(journeyId);
    const currentVersion = current?.version ?? 0;
    if (currentVersion !== dto.baseVersion) {
      throw this.versionConflict(currentVersion);
    }
    if (currentVersion === 0 && dto.reason !== 'INITIAL') {
      throw new BadRequestException(
        'The first canonical route must use the INITIAL reason',
      );
    }
    if (currentVersion > 0 && dto.reason === 'INITIAL') {
      throw new BadRequestException(
        'INITIAL cannot replace an existing canonical route',
      );
    }

    const route = await this.mapsService.getRoute(
      dto.originLat,
      dto.originLng,
      journey.destination.latitude,
      journey.destination.longitude,
    );
    if (!route) {
      throw new BadGatewayException('No road route was found');
    }

    try {
      return await this.routeRepository.replaceCurrent({
        journeyId,
        baseVersion: dto.baseVersion,
        coordinates: route.coordinates,
        distanceMetres: route.distanceMetres,
        durationSeconds: route.durationSeconds,
        steps: route.steps,
        origin: { latitude: dto.originLat, longitude: dto.originLng },
        destination: journey.destination,
        reason: dto.reason,
        createdBy: userId,
        requestId: dto.requestId,
      });
    } catch (error) {
      if (error instanceof JourneyRouteVersionConflictError) {
        throw this.versionConflict(error.currentVersion);
      }
      throw error;
    }
  }

  private versionConflict(currentVersion: number): ConflictException {
    return new ConflictException({
      statusCode: 409,
      code: 'ROUTE_VERSION_CONFLICT',
      message: 'The canonical route has changed',
      currentVersion,
    });
  }
}
