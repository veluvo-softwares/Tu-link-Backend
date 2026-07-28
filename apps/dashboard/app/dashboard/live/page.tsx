import { auth } from '@clerk/nextjs/server';
import { LiveJourneyMap, type LiveJourney } from './live-journey-map';

interface ApiEnvelope<T> {
  data: T;
}

const apiBaseUrl = process.env.TULINK_API_URL ?? 'http://localhost:3000';

async function getLiveJourneys(token: string) {
  const response = await fetch(`${apiBaseUrl}/operator/live-journeys`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Tulink API returned ${response.status}`);
  }
  const payload = (await response.json()) as ApiEnvelope<LiveJourney[]>;
  return payload.data;
}

export default async function LiveMapPage() {
  await auth.protect();
  const { getToken, orgId } = await auth();

  if (!orgId) {
    return (
      <main className="dashboard-shell">
        <section className="tulink-panel empty-state">
          <p className="eyebrow">Organization required</p>
          <h1>Select an organization to view live journeys.</h1>
        </section>
      </main>
    );
  }

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
  if (!mapboxToken) {
    return (
      <main className="dashboard-shell">
        <section className="tulink-panel empty-state">
          <p className="eyebrow">Mapbox configuration</p>
          <h1>Add the dashboard Mapbox public token.</h1>
          <p>
            Set `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` and restart the dashboard.
          </p>
        </section>
      </main>
    );
  }

  const token = await getToken();
  let journeys: LiveJourney[] = [];
  let loadError = '';

  if (token) {
    try {
      journeys = await getLiveJourneys(token);
    } catch {
      loadError =
        'The live feed could not be loaded. Check the API and Clerk configuration.';
    }
  }

  return (
    <main className="live-map-page">
      {loadError ? <div className="map-load-warning">{loadError}</div> : null}
      <LiveJourneyMap
        initialJourneys={journeys}
        mapboxToken={mapboxToken}
      />
    </main>
  );
}
