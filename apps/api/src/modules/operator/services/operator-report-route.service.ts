import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrganizationAccessRepository } from '../../../database/repositories/organization-access.repository';
import { JourneyRepository } from '../../../database/repositories/journey.repository';
import { JourneyRouteRepository } from '../../../database/repositories/journey-route.repository';
import { AnalyticsRepository } from '../../../database/repositories/analytics.repository';

function validCoordinates(value: unknown): value is [number, number][] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.every(
      (p: unknown) =>
        Array.isArray(p) &&
        p.length === 2 &&
        typeof p[0] === 'number' &&
        typeof p[1] === 'number' &&
        Number.isFinite(p[0]) &&
        Number.isFinite(p[1]) &&
        Math.abs(p[0]) <= 180 &&
        Math.abs(p[1]) <= 90,
    )
  );
}

@Injectable()
export class OperatorReportRouteService {
  constructor(
    private readonly accessRepository: OrganizationAccessRepository,
    private readonly journeys: JourneyRepository,
    private readonly routes: JourneyRouteRepository,
    private readonly analytics: AnalyticsRepository,
  ) {}

  async getRoute(orgId: string, userId: string, journeyId: string) {
    const access = await this.accessRepository.getAccess(orgId, userId);
    if (!access)
      throw new ForbiddenException('Active organization membership required');
    const journey = await this.journeys.findVisibleByOrganization(
      journeyId,
      access.organizationId,
      access.visibleUserIds ?? undefined,
    );
    if (!journey) throw new NotFoundException('Visible journey not found');
    const analytics = await this.analytics.findByJourneyId(journeyId);
    if (analytics?.routePolyline) {
      try {
        // Analytics stores the leader's ordered GPS samples as JSON, not an encoded polyline.
        const points: unknown = JSON.parse(analytics.routePolyline);
        const coordinates: unknown = Array.isArray(points)
          ? points.map((p: unknown) => {
              const point = p as { lng?: unknown; lat?: unknown } | null;
              return [point?.lng, point?.lat];
            })
          : null;
        if (validCoordinates(coordinates))
          return { source: 'recorded' as const, coordinates };
      } catch {
        /* Old or malformed analytics: try the saved navigation route. */
      }
    }
    const route = await this.routes.findCurrent(journeyId);
    if (route && validCoordinates(route.coordinates)) {
      return {
        source: 'navigation' as const,
        coordinates: route.coordinates,
        version: route.version,
      };
    }
    return null;
  }
}
