import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { operatorFetch } from '../operator-api';

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
  const response = await operatorFetch('/operator/journeys', token);

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
      tone: 'live',
    },
    {
      label: 'Pending journeys',
      value: pending.length,
      detail: 'Created and waiting to start',
      tone: 'pending',
    },
    {
      label: 'Scheduled',
      value: scheduled.length,
      detail: 'Planned departures ahead',
      tone: 'scheduled',
    },
  ];

  return (
    <main className="dashboard-shell">
      <section className="dashboard-content">
        <div className="dashboard-heading">
          <div>
            <p className="eyebrow">Organization command</p>
            <h1>Operations control</h1>
            <p className="page-intro">
              Monitor active convoys, upcoming departures, and journeys that
              need operator attention.
            </p>
          </div>
          <span className={`live-badge ${loadError ? 'offline' : ''}`}>
            {loadError ? 'Feed offline' : 'Live feed'}
          </span>
        </div>

        {loadError ? (
          <div className="api-warning">
            The Tulink API is temporarily unavailable. Retry in a moment or
            contact support if the problem continues.
          </div>
        ) : null}

        <div className="metric-grid">
          {cards.map((card) => (
            <article
              key={card.label}
              className={`tulink-panel metric-card ${card.tone}`}
            >
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
            <div className="section-actions">
              <span>{recent.length} visible</span>
              <Link className="text-link" href="/dashboard/live">
                Open live tracking
              </Link>
            </div>
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
