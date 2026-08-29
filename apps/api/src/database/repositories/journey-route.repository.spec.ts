import { journeys } from '../schema';
import {
  JourneyRouteInactiveError,
  JourneyRouteRepository,
  type ReplaceJourneyRouteInput,
} from './journey-route.repository';

describe('JourneyRouteRepository', () => {
  const input: ReplaceJourneyRouteInput = {
    journeyId: '11111111-1111-4111-8111-111111111111',
    baseVersion: 0,
    coordinates: [
      [36.7, -1.2],
      [36.8, -1.3],
    ],
    distanceMetres: 15000,
    durationSeconds: 1800,
    steps: [],
    origin: { latitude: -1.2, longitude: 36.7 },
    destination: { latitude: -1.3, longitude: 36.8 },
    reason: 'INITIAL',
    createdBy: 'leader-1',
    requestId: '22222222-2222-4222-8222-222222222222',
  };

  it('revalidates ACTIVE status while holding the journey lock', async () => {
    const forUpdate = jest.fn().mockResolvedValue([
      {
        id: input.journeyId,
        status: 'COMPLETED',
      },
    ]);
    const where = jest.fn().mockReturnValue({ for: forUpdate });
    const from = jest.fn().mockReturnValue({ where });
    const select = jest.fn().mockReturnValue({ from });
    const tx = { select };
    const databaseService = {
      db: {
        transaction: jest.fn(
          async (callback: (transaction: typeof tx) => Promise<unknown>) =>
            callback(tx),
        ),
      },
    };
    const repository = new JourneyRouteRepository(databaseService as never);

    await expect(repository.replaceCurrent(input)).rejects.toBeInstanceOf(
      JourneyRouteInactiveError,
    );
    expect(select).toHaveBeenCalledWith({
      id: journeys.id,
      status: journeys.status,
    });
    expect(forUpdate).toHaveBeenCalledWith('update');
  });
});
