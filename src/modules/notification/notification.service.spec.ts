import { Test, TestingModule } from '@nestjs/testing';
import { FcmTokenRepository } from '../../database/repositories/fcm-token.repository';
import { NotificationRepository } from '../../database/repositories/notification.repository';
import { UsersRepository } from '../../database/repositories/users.repository';
import { LoggerService } from '../../shared/logger/logger.service';
import { RedisService } from '../../shared/redis/redis.service';
import { NotificationService } from './notification.service';
import { FcmService } from './services/fcm.service';

describe('NotificationService.sendLagAlert', () => {
  let service: NotificationService;
  let logger: jest.Mocked<Pick<LoggerService, 'warn'>>;

  const journeyId = 'journey-1';
  const laggardUserId = 'laggard-1';
  const groupRecipientIds = ['leader-1', 'other-1'];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        {
          provide: NotificationRepository,
          useValue: { create: jest.fn().mockResolvedValue({}) },
        },
        {
          provide: FcmTokenRepository,
          useValue: { getTokens: jest.fn().mockResolvedValue([]) },
        },
        { provide: UsersRepository, useValue: {} },
        {
          provide: FcmService,
          useValue: { sendToUser: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: LoggerService, useValue: { warn: jest.fn() } },
        { provide: RedisService, useValue: {} },
      ],
    }).compile();

    service = module.get(NotificationService);
    logger = module.get(LoggerService);
  });

  it('persists the self-directed and group-directed notification legs', async () => {
    const createNotification = jest.spyOn(service, 'createNotification');

    await service.sendLagAlert(
      journeyId,
      laggardUserId,
      'Charlie',
      620,
      'WARNING',
      groupRecipientIds,
    );

    expect(createNotification).toHaveBeenCalledTimes(3);
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: laggardUserId }),
    );
    for (const recipientId of groupRecipientIds) {
      expect(createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ recipientId }),
      );
    }
  });

  it('continues the group leg when the laggard leg rejects', async () => {
    const createNotification = jest
      .spyOn(service, 'createNotification')
      .mockImplementation((dto) => {
        if (dto.recipientId === laggardUserId) {
          return Promise.reject(new Error('laggard persistence failed'));
        }
        return Promise.resolve({} as never);
      });

    await expect(
      service.sendLagAlert(
        journeyId,
        laggardUserId,
        'Charlie',
        620,
        'WARNING',
        groupRecipientIds,
      ),
    ).resolves.toBeUndefined();

    for (const recipientId of groupRecipientIds) {
      expect(createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ recipientId }),
      );
    }
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Laggard lag-alert notification failed'),
      'NotificationService',
    );
  });
});
