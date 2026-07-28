import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PriorityService } from './priority.service';
import { LocationUpdate } from '../../../shared/interfaces/location.interface';

describe('PriorityService', () => {
  let service: PriorityService;

  // Default config: MEDIUM never throttled (0ms), LOW throttled under 2000ms.
  const configValues: Record<string, number> = {
    'app.liveThrottleMediumMs': 0,
    'app.liveThrottleLowMs': 2000,
  };

  const update = {
    journeyId: 'journey-1',
    participantId: 'participant-1',
    location: { latitude: 0, longitude: 0 },
    accuracy: 5,
    timestamp: Date.now(),
  } as LocationUpdate;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PriorityService,
        {
          provide: ConfigService,
          useValue: {
            get: jest
              .fn()
              .mockImplementation(
                (key: string, defaultValue?: number) =>
                  configValues[key] ?? defaultValue,
              ),
          },
        },
      ],
    }).compile();

    service = module.get<PriorityService>(PriorityService);
  });

  describe('shouldThrottle', () => {
    it('returns false when there is no previous update time', () => {
      expect(service.shouldThrottle(update, 'LOW', null)).toBe(false);
    });

    it('never throttles HIGH priority', () => {
      const justNow = Date.now();
      expect(service.shouldThrottle(update, 'HIGH', justNow)).toBe(false);
    });

    it('never throttles MEDIUM priority with default config (0ms floor)', () => {
      const justNow = Date.now();
      expect(service.shouldThrottle(update, 'MEDIUM', justNow)).toBe(false);

      const longAgo = Date.now() - 60_000;
      expect(service.shouldThrottle(update, 'MEDIUM', longAgo)).toBe(false);
    });

    it('throttles LOW priority only when under the 2000ms floor', () => {
      const within = Date.now() - 500;
      expect(service.shouldThrottle(update, 'LOW', within)).toBe(true);

      const atFloor = Date.now() - 2000;
      expect(service.shouldThrottle(update, 'LOW', atFloor)).toBe(false);

      const beyond = Date.now() - 5000;
      expect(service.shouldThrottle(update, 'LOW', beyond)).toBe(false);
    });
  });
});
