import { MapsService } from './maps.service';

describe('MapsService route caching', () => {
  it('keeps nearby route origins in distinct cache buckets', async () => {
    const cachedRoute = JSON.stringify({
      coordinates: [[36.8, -1.3]],
      distanceMetres: 100,
      durationSeconds: 10,
      steps: [],
    });
    const get = jest.fn().mockResolvedValue(cachedRoute);
    const configService = {
      getOrThrow: jest.fn().mockReturnValue('test-key'),
    };
    const redisService = {
      getClient: jest.fn().mockReturnValue({ get }),
    };
    const service = new MapsService(
      configService as never,
      redisService as never,
    );

    await service.getRoute(-1.234501, 36.765401, -1.3, 36.8);
    await service.getRoute(-1.234509, 36.765409, -1.3, 36.8);

    expect(get).toHaveBeenNthCalledWith(
      1,
      'maps:route:-1.234501:36.765401:-1.300000:36.800000',
    );
    expect(get).toHaveBeenNthCalledWith(
      2,
      'maps:route:-1.234509:36.765409:-1.300000:36.800000',
    );
  });
});
