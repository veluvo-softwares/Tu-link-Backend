import { LocationController } from './location.controller';
import { LocationGateway } from './location.gateway';
import { LocationService } from './location.service';

describe('LocationController REST fallback', () => {
  it('applies arrival side effects after processing a location update', async () => {
    const arrival = {
      arrived: true,
      alreadyArrived: false,
      arrivedCount: 2,
      totalCount: 2,
      allArrived: true,
    };
    const locationService = {
      processLocationUpdate: jest.fn().mockResolvedValue({
        success: true,
        sequenceNumber: 4,
        priority: 'HIGH',
        arrival,
      }),
    } as unknown as LocationService;
    const handleArrivalResult = jest.fn().mockResolvedValue(undefined);
    const locationGateway = {
      handleArrivalResult,
    } as unknown as LocationGateway;
    const controller = new LocationController(locationService, locationGateway);
    const dto = {
      journeyId: 'journey-1',
      location: { latitude: -1.2921, longitude: 36.8219 },
      accuracy: 10,
      timestamp: Date.now(),
    };

    await controller.createLocationUpdate('user-1', dto);

    expect(handleArrivalResult).toHaveBeenCalledWith(
      'journey-1',
      'user-1',
      arrival,
    );
  });
});
