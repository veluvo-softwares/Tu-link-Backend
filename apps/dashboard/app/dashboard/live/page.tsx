import { auth } from '@clerk/nextjs/server';
import { LiveJourneyMap, type LiveJourney } from './live-journey-map';

interface ApiEnvelope<T> {
  data: T;
}

const apiBaseUrl = process.env.TULINK_API_URL ?? 'http://localhost:3000';

function createDemoJourneys(now: number): LiveJourney[] {
  const member = (
    journeyId: string,
    participantId: string,
    displayName: string,
    latitude: number,
    longitude: number,
    secondsAgo: number,
    speed: number,
    batteryLevel: number,
    connectionState = 'CONNECTED',
  ) => ({
    journeyId,
    participantId,
    displayName,
    location: { latitude, longitude },
    heading: 35,
    speed,
    timestamp: now - secondsAgo * 1_000,
    positionRecordedAt: now - secondsAgo * 1_000,
    connectionState,
    lastSeenAt: now - secondsAgo * 1_000,
    metadata: { batteryLevel, isMoving: speed > 1 },
  });

  return [
    {
      journey: {
        id: 'demo-westlands-airport',
        name: 'Westlands to JKIA',
        destinationAddress: 'Jomo Kenyatta International Airport',
      },
      snapshot: {
        participants: {
          amani: member(
            'demo-westlands-airport',
            'amani',
            'Amani K.',
            -1.2926,
            36.8524,
            7,
            14.4,
            0.82,
          ),
          kamau: member(
            'demo-westlands-airport',
            'kamau',
            'Kamau M.',
            -1.3048,
            36.8752,
            43,
            8.9,
            0.46,
          ),
          wanjiru: member(
            'demo-westlands-airport',
            'wanjiru',
            'Wanjiru N.',
            -1.3162,
            36.8954,
            9,
            15.1,
            0.67,
          ),
        },
        destination: { latitude: -1.3192, longitude: 36.9278 },
        destinationAddress: 'Jomo Kenyatta International Airport',
      },
    },
    {
      journey: {
        id: 'demo-karen-gigiri',
        name: 'Karen to Gigiri',
        destinationAddress: 'United Nations Avenue, Gigiri',
      },
      snapshot: {
        participants: {
          brian: member(
            'demo-karen-gigiri',
            'brian',
            'Brian O.',
            -1.2652,
            36.8069,
            6,
            12.2,
            0.91,
          ),
          faith: member(
            'demo-karen-gigiri',
            'faith',
            'Faith W.',
            -1.2481,
            36.8155,
            8,
            11.6,
            0.74,
          ),
        },
        destination: { latitude: -1.2291, longitude: 36.8172 },
        destinationAddress: 'United Nations Avenue, Gigiri',
      },
    },
    {
      journey: {
        id: 'demo-rongai-cbd',
        name: 'Rongai to CBD',
        destinationAddress: 'Kenyatta Avenue, Nairobi',
      },
      snapshot: {
        participants: {
          leah: member(
            'demo-rongai-cbd',
            'leah',
            'Leah A.',
            -1.3564,
            36.7551,
            12,
            13.8,
            0.58,
          ),
          musa: member(
            'demo-rongai-cbd',
            'musa',
            'Musa J.',
            -1.3421,
            36.7712,
            74,
            0,
            0.29,
            'DISCONNECTED',
          ),
        },
        destination: { latitude: -1.2865, longitude: 36.8174 },
        destinationAddress: 'Kenyatta Avenue, Nairobi',
      },
    },
  ];
}

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

export default async function LiveMapPage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  await auth.protect();
  const { getToken, orgId } = await auth();
  const demoMode =
    process.env.NODE_ENV === 'development' && (await searchParams).demo === '1';

  if (!orgId) {
    return (
      <main className="dashboard-shell">
        <section className="tulink-panel empty-state">
          <p className="eyebrow">Choose an organization</p>
          <h1>Select an organization to view live journeys</h1>
          <p>Your journey visibility depends on the active organization.</p>
        </section>
      </main>
    );
  }

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
  if (!mapboxToken) {
    return (
      <main className="dashboard-shell">
        <section className="tulink-panel empty-state">
          <p className="eyebrow">Map unavailable</p>
          <h1>Live map is not available</h1>
          <p>Journey information is still available from Overview.</p>
        </section>
      </main>
    );
  }

  const token = await getToken();
  const renderedAt = Date.now();
  let journeys: LiveJourney[] = demoMode ? createDemoJourneys(renderedAt) : [];
  let loadError = '';

  if (token && !demoMode) {
    try {
      journeys = await getLiveJourneys(token);
    } catch {
      loadError =
        'Live updates are unavailable. We will keep trying to reconnect.';
    }
  }

  return (
    <main className="live-map-page">
      {loadError ? <div className="map-load-warning">{loadError}</div> : null}
      <LiveJourneyMap
        demoMode={demoMode}
        initialJourneys={journeys}
        initialNow={renderedAt}
        mapboxToken={mapboxToken}
      />
    </main>
  );
}
