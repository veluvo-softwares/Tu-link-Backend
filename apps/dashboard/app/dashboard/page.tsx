import { auth } from '@clerk/nextjs/server';

interface OperatorJourney {
  id: string;
  name: string;
  leaderId: string;
  organizationId: string | null;
  status: 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  scheduledFor: string | null;
  destinationAddress: string | null;
  createdAt: string;
}

interface ApiResponse<T> {
  data: T;
}

async function getOrganizationJourneys(token: string) {
  const apiUrl = process.env.TULINK_API_URL ?? 'http://localhost:3000';
  const response = await fetch(`${apiUrl}/operator/journeys`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Tulink API returned ${response.status}`);
  }

  const payload = (await response.json()) as ApiResponse<OperatorJourney[]>;
  return payload.data;
}

function formatSchedule(value: string | null) {
  if (!value) return 'Start when ready';
  return new Intl.DateTimeFormat('en-KE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Nairobi',
  }).format(new Date(value));
}

export default async function DashboardPage() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return (
      <main className="dashboard-shell">
        <h1>Dashboard scaffold ready</h1>
        <p>Add the Clerk environment keys to enable this route.</p>
      </main>
    );
  }

  await auth.protect();
  const { getToken, orgId } = await auth();

  if (!orgId) {
    return (
      <main className="dashboard-shell">
        <section className="tulink-panel empty-state">
          <p className="eyebrow">Organization required</p>
          <h1>Select or create an organization</h1>
          <p>Journey visibility is always scoped to the active organization.</p>
        </section>
      </main>
    );
  }

  const token = await getToken();
  let journeys: OperatorJourney[] = [];
  let loadError = false;

  if (token) {
    try {
      journeys = await getOrganizationJourneys(token);
    } catch {
      loadError = true;
    }
  } else {
    loadError = true;
  }

  const live = journeys.filter((journey) => journey.status === 'ACTIVE');
  const scheduled = journeys.filter(
    (journey) => journey.status === 'PENDING' && journey.scheduledFor,
  );
  const pending = journeys.filter(
    (journey) => journey.status === 'PENDING' && !journey.scheduledFor,
  );
  const recent = [...live, ...scheduled, ...pending].slice(0, 8);
  const cards = [
    {
      label: 'Live journeys',
      value: live.length,
      detail: 'Teams currently moving',
    },
    {
      label: 'Pending journeys',
      value: pending.length,
      detail: 'Created and waiting to start',
    },
    {
      label: 'Scheduled',
      value: scheduled.length,
      detail: 'Planned departures ahead',
    },
  ];

  return (
    <main className="dashboard-shell">
      <section className="dashboard-content">
        <div className="dashboard-heading">
          <div>
            <p className="eyebrow">Organization operations</p>
            <h1>Every team journey, one command view.</h1>
          </div>
          <span className="live-badge">LIVE</span>
        </div>

        {loadError ? (
          <div className="api-warning">
            The Tulink API could not be reached. Check `TULINK_API_URL` and the
            backend Clerk configuration.
          </div>
        ) : null}

        <div className="metric-grid">
          {cards.map((card) => (
            <article key={card.label} className="tulink-panel metric-card">
              <p>{card.label}</p>
              <strong>{card.value}</strong>
              <span>{card.detail}</span>
            </article>
          ))}
        </div>

        <section className="tulink-panel journey-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Operational queue</p>
              <h2>Open journeys</h2>
            </div>
            <span>{recent.length} visible</span>
          </div>

          {recent.length === 0 ? (
            <div className="empty-state">
              <h3>No open team journeys</h3>
              <p>
                Add Tulink app users to this organization to attribute their
                next journeys automatically.
              </p>
            </div>
          ) : (
            <div className="journey-list">
              {recent.map((journey) => (
                <article key={journey.id} className="journey-row">
                  <div>
                    <span
                      className={`status-dot ${journey.status.toLowerCase()}`}
                    />
                    <div>
                      <h3>{journey.name}</h3>
                      <p>
                        {journey.destinationAddress ?? 'Destination pending'}
                      </p>
                    </div>
                  </div>
                  <div className="journey-meta">
                    <strong>{journey.status}</strong>
                    <span>{formatSchedule(journey.scheduledFor)}</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
