import { auth } from '@clerk/nextjs/server';
import { operatorFetch } from '../../../../operator-api';
import { reportFields, type JourneyReport } from '../../../../journey-reports';
import { buildJourneyPdf } from '../../../../journey-report-pdf';

import {
  buildRouteMap,
  parseReportRoute,
  type RouteMap,
} from '../../../../journey-route-map';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const privateHeaders = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ journeyId: string }> },
) {
  const { userId, orgId, getToken } = await auth();
  if (!userId)
    return new Response('Sign in to view journey reports.', {
      status: 401,
      headers: privateHeaders,
    });
  if (!orgId)
    return new Response('Select an organization to view journey reports.', {
      status: 403,
      headers: privateHeaders,
    });
  const { journeyId } = await params;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      journeyId,
    )
  )
    return new Response('Journey not found.', {
      status: 404,
      headers: privateHeaders,
    });
  try {
    const token = await getToken();
    if (!token)
      return new Response('Session expired. Sign in again.', {
        status: 401,
        headers: privateHeaders,
      });
    // Recheck current organization and delegated visibility on every export.
    const response = await operatorFetch('/operator/journeys', token);
    if (!response.ok)
      return new Response('Unable to load this journey report.', {
        status: [401, 403].includes(response.status) ? response.status : 502,
        headers: privateHeaders,
      });
    const payload = await response.json();
    if (!Array.isArray(payload.data))
      throw new Error('Invalid journey response');
    const journey = (payload.data as JourneyReport[]).find(
      (item) => item.id === journeyId,
    );
    if (!journey)
      return new Response('Journey not found.', {
        status: 404,
        headers: privateHeaders,
      });
    let routeMap: RouteMap = {
      caption:
        'Route map could not be loaded. Please try exporting again later.',
    };
    try {
      const routeResponse = await operatorFetch(
        `/operator/journeys/${journeyId}/report-route`,
        token,
      );
      if ([401, 403, 404].includes(routeResponse.status))
        return new Response('Journey access is no longer available.', {
          status: routeResponse.status,
          headers: privateHeaders,
        });
      if (routeResponse.ok) {
        const routePayload = await routeResponse.json();
        routeMap = await buildRouteMap(parseReportRoute(routePayload.data));
      }
    } catch {
      /* The report explicitly labels route lookup failures. */
    }
    const bytes = await buildJourneyPdf(
      reportFields(journey),
      new Date(),
      routeMap,
    );
    const disposition =
      new URL(request.url).searchParams.get('download') === '1'
        ? 'attachment'
        : 'inline';
    return new Response(Buffer.from(bytes), {
      headers: {
        ...privateHeaders,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${disposition}; filename="tulink-journey-${journeyId}.pdf"`,
      },
    });
  } catch {
    return new Response(
      'The report could not be generated. Please try again.',
      { status: 502, headers: privateHeaders },
    );
  }
}
