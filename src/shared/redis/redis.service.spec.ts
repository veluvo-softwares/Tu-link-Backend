import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../logger/logger.service';
import { RedisService } from './redis.service';

describe('RedisService.claimLagAlertCooldown', () => {
  let service: RedisService;
  let evalMock: jest.Mock;
  let logger: jest.Mocked<Pick<LoggerService, 'warn'>>;

  beforeEach(() => {
    logger = { warn: jest.fn() };
    service = new RedisService(
      {} as ConfigService,
      logger as unknown as LoggerService,
    );
    evalMock = jest.fn();
    Reflect.set(service, 'client', { eval: evalMock });
  });

  it('maps the atomic Redis claim result to ACQUIRED', async () => {
    evalMock.mockResolvedValue(1);

    const result = await service.claimLagAlertCooldown(
      'journey-1',
      'user-1',
      'WARNING',
      300,
    );

    expect(result).toBe('ACQUIRED');
    expect(evalMock).toHaveBeenCalledWith(
      expect.stringContaining("currentSeverity == 'WARNING'"),
      1,
      'lag:cooldown:journey-1:user-1',
      'WARNING',
      '300',
    );
  });

  it('allows only the Redis-selected winner across overlapping claims', async () => {
    evalMock.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    const results = await Promise.all([
      service.claimLagAlertCooldown('journey-1', 'user-1', 'WARNING', 300),
      service.claimLagAlertCooldown('journey-1', 'user-1', 'WARNING', 300),
    ]);

    expect(results).toEqual(['ACQUIRED', 'SUPPRESSED']);
  });

  it('returns UNAVAILABLE rather than permission to send when Redis fails', async () => {
    evalMock.mockRejectedValue(new Error('redis unavailable'));

    const result = await service.claimLagAlertCooldown(
      'journey-1',
      'user-1',
      'CRITICAL',
      120,
    );

    expect(result).toBe('UNAVAILABLE');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('redis unavailable'),
      'RedisService',
      expect.objectContaining({ event: 'lag_cooldown_unavailable' }),
    );
  });
});
