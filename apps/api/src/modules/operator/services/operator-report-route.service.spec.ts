import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { OperatorReportRouteService } from './operator-report-route.service';

describe('OperatorReportRouteService', () => {
  const access = { getAccess: jest.fn() };
  const journeys = { findVisibleByOrganization: jest.fn() };
  const routes = { findCurrent: jest.fn() };
  const analytics = { findByJourneyId: jest.fn() };
  let service: OperatorReportRouteService;
  beforeEach(() => {
    jest.resetAllMocks();
    access.getAccess.mockResolvedValue({
      organizationId: 'local-org',
      visibleUserIds: ['leader'],
    });
    journeys.findVisibleByOrganization.mockResolvedValue({ id: 'journey' });
    analytics.findByJourneyId.mockResolvedValue(null);
    routes.findCurrent.mockResolvedValue(null);
    service = new OperatorReportRouteService(
      access as never,
      journeys as never,
      routes as never,
      analytics as never,
    );
  });
  it('checks active membership and journey visibility before reading route data', async () => {
    access.getAccess.mockResolvedValue(null);
    await expect(
      service.getRoute('org', 'user', 'journey'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(analytics.findByJourneyId).not.toHaveBeenCalled();
  });
  it('rejects journeys outside delegated scope before reading route data', async () => {
    journeys.findVisibleByOrganization.mockResolvedValue(null);
    await expect(
      service.getRoute('org', 'user', 'journey'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(journeys.findVisibleByOrganization).toHaveBeenCalledWith(
      'journey',
      'local-org',
      ['leader'],
    );
    expect(routes.findCurrent).not.toHaveBeenCalled();
    expect(analytics.findByJourneyId).not.toHaveBeenCalled();
  });
  it('prefers the ordered recorded leader track over a planned route', async () => {
    analytics.findByJourneyId.mockResolvedValue({
      routePolyline: '[{"lat":-1,"lng":36},{"lat":-2,"lng":37}]',
    });
    expect(await service.getRoute('org', 'user', 'journey')).toEqual({
      source: 'recorded',
      coordinates: [
        [36, -1],
        [37, -2],
      ],
    });
    expect(routes.findCurrent).not.toHaveBeenCalled();
  });
  it('labels the saved route fallback and omits internal identities', async () => {
    analytics.findByJourneyId.mockResolvedValue({ routePolyline: 'invalid' });
    routes.findCurrent.mockResolvedValue({
      coordinates: [
        [36, -1],
        [37, -2],
      ],
      version: 3,
      createdBy: 'private',
    });
    expect(await service.getRoute('org', 'user', 'journey')).toEqual({
      source: 'navigation',
      coordinates: [
        [36, -1],
        [37, -2],
      ],
      version: 3,
    });
  });
  it('returns null when no usable geometry exists', async () => {
    analytics.findByJourneyId.mockResolvedValue({
      routePolyline: '[{"lat":999,"lng":36},{"lat":-2,"lng":37}]',
    });
    expect(await service.getRoute('org', 'user', 'journey')).toBeNull();
  });
});
