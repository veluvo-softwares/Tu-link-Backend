import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  JourneyRouteInactiveError,
  JourneyRouteVersionConflictError,
  type JourneyRouteRecord,
} from '../../../database/repositories/journey-route.repository';
import { JourneyRouteService } from './journey-route.service';

describe('JourneyRouteService', () => {
  const journeyId = '11111111-1111-4111-8111-111111111111';
  const leaderId = 'leader-1';
  const requestId = '22222222-2222-4222-8222-222222222222';
  const destination = { latitude: -1.3, longitude: 36.8 };
  const dto = {
    originLat: -1.2,
    originLng: 36.7,
    baseVersion: 0,
    reason: 'INITIAL' as const,
    requestId,
  };
  const calculatedRoute = {
    coordinates: [
      [36.7, -1.2],
      [36.8, -1.3],
    ],
    distanceMetres: 15000,
    durationSeconds: 1800,
    steps: [
      {
        instruction: 'Continue straight',
        distanceMetres: 15000,
        maneuver: 'straight',
      },
    ],
  };
  const savedRoute: JourneyRouteRecord = {
    id: '33333333-3333-4333-8333-333333333333',
    journeyId,
    version: 1,
    ...calculatedRoute,
    origin: { latitude: dto.originLat, longitude: dto.originLng },
    destination,
    reason: 'INITIAL',
    createdBy: leaderId,
    requestId,
    isCurrent: true,
    createdAt: new Date('2026-08-29T12:00:00Z'),
  };

  let service: JourneyRouteService;
  let routeRepository: {
    findCurrent: jest.Mock;
    findByRequestId: jest.Mock;
    replaceCurrent: jest.Mock;
  };
  let journeyRepository: { findById: jest.Mock };
  let participantService: { isParticipant: jest.Mock };
  let mapsService: { getRoute: jest.Mock };

  beforeEach(() => {
    routeRepository = {
      findCurrent: jest.fn().mockResolvedValue(null),
      findByRequestId: jest.fn().mockResolvedValue(null),
      replaceCurrent: jest.fn().mockResolvedValue(savedRoute),
    };
    journeyRepository = {
      findById: jest.fn().mockResolvedValue({
        id: journeyId,
        leaderId,
        status: 'ACTIVE',
        destination,
      }),
    };
    participantService = {
      isParticipant: jest.fn().mockResolvedValue(true),
    };
    mapsService = {
      getRoute: jest.fn().mockResolvedValue(calculatedRoute),
    };

    service = new JourneyRouteService(
      routeRepository as never,
      journeyRepository as never,
      participantService as never,
      mapsService as never,
    );
  });

  it('returns the current route to a journey participant', async () => {
    routeRepository.findCurrent.mockResolvedValue(savedRoute);

    await expect(service.getCurrent(journeyId, 'member-1')).resolves.toBe(
      savedRoute,
    );
    expect(participantService.isParticipant).toHaveBeenCalledWith(
      journeyId,
      'member-1',
    );
  });

  it('does not expose a route to a non-participant', async () => {
    participantService.isParticipant.mockResolvedValue(false);

    await expect(
      service.getCurrent(journeyId, 'outsider'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(routeRepository.findCurrent).not.toHaveBeenCalled();
  });

  it('calculates and persists the first canonical route', async () => {
    await expect(
      service.replaceCurrent(journeyId, leaderId, dto),
    ).resolves.toBe(savedRoute);

    expect(mapsService.getRoute).toHaveBeenCalledWith(
      dto.originLat,
      dto.originLng,
      destination.latitude,
      destination.longitude,
    );
    expect(routeRepository.replaceCurrent).toHaveBeenCalledWith({
      journeyId,
      baseVersion: 0,
      ...calculatedRoute,
      origin: { latitude: dto.originLat, longitude: dto.originLng },
      destination,
      reason: 'INITIAL',
      createdBy: leaderId,
      requestId,
    });
  });

  it('returns an idempotent result without recalculating the route', async () => {
    routeRepository.findByRequestId.mockResolvedValue(savedRoute);

    await expect(
      service.replaceCurrent(journeyId, leaderId, dto),
    ).resolves.toBe(savedRoute);
    expect(routeRepository.findCurrent).not.toHaveBeenCalled();
    expect(mapsService.getRoute).not.toHaveBeenCalled();
    expect(routeRepository.replaceCurrent).not.toHaveBeenCalled();
  });

  it('rejects canonical route changes from a follower', async () => {
    await expect(
      service.replaceCurrent(journeyId, 'follower-1', dto),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mapsService.getRoute).not.toHaveBeenCalled();
  });

  it('rejects route changes when the journey is not active', async () => {
    journeyRepository.findById.mockResolvedValue({
      id: journeyId,
      leaderId,
      status: 'COMPLETED',
      destination,
    });

    await expect(
      service.replaceCurrent(journeyId, leaderId, dto),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mapsService.getRoute).not.toHaveBeenCalled();
  });

  it('rejects a stale base version before calling Mapbox', async () => {
    routeRepository.findCurrent.mockResolvedValue({
      ...savedRoute,
      version: 2,
    });

    const promise = service.replaceCurrent(journeyId, leaderId, dto);
    await expect(promise).rejects.toBeInstanceOf(ConflictException);
    const error = await promise.catch((caught: unknown) => caught);
    const response = (error as ConflictException).getResponse();
    expect(response).toMatchObject({
      code: 'ROUTE_VERSION_CONFLICT',
      currentVersion: 2,
    });
    expect(mapsService.getRoute).not.toHaveBeenCalled();
  });

  it('requires the initial reason for the first canonical route', async () => {
    await expect(
      service.replaceCurrent(journeyId, leaderId, {
        ...dto,
        reason: 'LEADER_REROUTE',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mapsService.getRoute).not.toHaveBeenCalled();
  });

  it('does not allow INITIAL to replace an existing route', async () => {
    routeRepository.findCurrent.mockResolvedValue(savedRoute);

    await expect(
      service.replaceCurrent(journeyId, leaderId, {
        ...dto,
        baseVersion: 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mapsService.getRoute).not.toHaveBeenCalled();
  });

  it('maps a raced repository version conflict to HTTP 409', async () => {
    routeRepository.replaceCurrent.mockRejectedValue(
      new JourneyRouteVersionConflictError(1),
    );

    const error = await service
      .replaceCurrent(journeyId, leaderId, dto)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConflictException);
    const response = (error as ConflictException).getResponse();
    expect(response).toMatchObject({
      code: 'ROUTE_VERSION_CONFLICT',
      currentVersion: 1,
    });
  });

  it('rejects a route when the journey ends during calculation', async () => {
    routeRepository.replaceCurrent.mockRejectedValue(
      new JourneyRouteInactiveError(),
    );

    await expect(
      service.replaceCurrent(journeyId, leaderId, dto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('fails clearly when Mapbox returns no road route', async () => {
    mapsService.getRoute.mockResolvedValue(null);

    await expect(
      service.replaceCurrent(journeyId, leaderId, dto),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(routeRepository.replaceCurrent).not.toHaveBeenCalled();
  });
});
