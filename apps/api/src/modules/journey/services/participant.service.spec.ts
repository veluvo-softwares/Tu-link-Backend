import { ParticipantRepository } from '../../../database/repositories/participant.repository';
import { RedisService } from '../../../shared/redis/redis.service';
import { ParticipantService } from './participant.service';

describe('ParticipantService.isActiveParticipant', () => {
  const participantRepository = {
    findOne: jest.fn(),
  } as unknown as jest.Mocked<ParticipantRepository>;
  const redisService = {} as RedisService;
  const service = new ParticipantService(participantRepository, redisService);

  beforeEach(() => jest.clearAllMocks());

  it.each(['ACCEPTED', 'ACTIVE', 'ARRIVED'] as const)(
    'allows location updates from a %s participant',
    async (status) => {
      participantRepository.findOne.mockResolvedValue({ status } as never);

      await expect(
        service.isActiveParticipant('journey-1', 'user-1'),
      ).resolves.toBe(true);
    },
  );

  it.each(['INVITED', 'LEFT', 'DECLINED'] as const)(
    'rejects location updates from a %s participant',
    async (status) => {
      participantRepository.findOne.mockResolvedValue({ status } as never);

      await expect(
        service.isActiveParticipant('journey-1', 'user-1'),
      ).resolves.toBe(false);
    },
  );

  it('rejects a user without a participant record', async () => {
    participantRepository.findOne.mockResolvedValue(null);

    await expect(
      service.isActiveParticipant('journey-1', 'user-1'),
    ).resolves.toBe(false);
  });
});
