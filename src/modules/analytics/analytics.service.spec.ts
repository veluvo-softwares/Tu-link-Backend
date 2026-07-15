import { AnalyticsRepository } from '../../database/repositories/analytics.repository';
import { JourneyRepository } from '../../database/repositories/journey.repository';
import { LagAlertRepository } from '../../database/repositories/lag-alert.repository';
import { LocationRepository } from '../../database/repositories/location.repository';
import { ParticipantRepository } from '../../database/repositories/participant.repository';
import { AnalyticsService } from './analytics.service';

describe('AnalyticsService.getUserJourneyHistory', () => {
  const findByJourneyIds = jest.fn();
  const findJourneyById = jest.fn();
  const findParticipationsByUser = jest.fn();
  const analyticsRepository = {
    findByJourneyIds,
  } as unknown as jest.Mocked<AnalyticsRepository>;
  const journeyRepository = {
    findById: findJourneyById,
  } as unknown as jest.Mocked<JourneyRepository>;
  const participantRepository = {
    findByUser: findParticipationsByUser,
  } as unknown as jest.Mocked<ParticipantRepository>;
  const service = new AnalyticsService(
    analyticsRepository,
    journeyRepository,
    {} as LocationRepository,
    {} as LagAlertRepository,
    participantRepository,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    findByJourneyIds.mockResolvedValue([]);
  });

  it('queries only joined participation states', async () => {
    findParticipationsByUser.mockResolvedValue([]);

    await expect(service.getUserJourneyHistory('user-1')).resolves.toEqual([]);

    expect(findParticipationsByUser).toHaveBeenCalledWith('user-1', [
      'ACCEPTED',
      'ACTIVE',
      'ARRIVED',
      'LEFT',
    ]);
    expect(findJourneyById).not.toHaveBeenCalled();
  });

  it('returns only completed or cancelled journeys, newest first', async () => {
    findParticipationsByUser.mockResolvedValue([
      { journeyId: 'active' },
      { journeyId: 'completed-old' },
      { journeyId: 'cancelled-new' },
    ] as never);
    const journeys = {
      active: {
        id: 'active',
        status: 'ACTIVE',
        createdAt: new Date('2026-07-03'),
      },
      'completed-old': {
        id: 'completed-old',
        status: 'COMPLETED',
        createdAt: new Date('2026-07-01'),
      },
      'cancelled-new': {
        id: 'cancelled-new',
        status: 'CANCELLED',
        createdAt: new Date('2026-07-02'),
      },
    };
    findJourneyById.mockImplementation((id: keyof typeof journeys) =>
      Promise.resolve(journeys[id]),
    );

    const history = (await service.getUserJourneyHistory('user-1')) as Array<{
      id: string;
    }>;

    expect(history.map((journey) => journey.id)).toEqual([
      'cancelled-new',
      'completed-old',
    ]);
    expect(findByJourneyIds).toHaveBeenCalledWith([
      'cancelled-new',
      'completed-old',
    ]);
  });
});
