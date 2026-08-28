import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { operatorFetch } from '../operator-api';
import type { LiveJourney } from './live/live-status';
import { summarizeLiveFeed } from './live/live-status';

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

async function getJson<T>(path: string, token: string) {
  const response = await operatorFetch(path, token);
  if (!response.ok) {
    throw new Error(`Tulink API returned ${response.status}`);
  }
  const payload = (await response.json()) as ApiResponse<T>;
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
          <div className="empty-state-actions">
            <Link className="tulink-button" href="/create-organization">
              Create workspace
            </Link>
          </div>
        </section>
      </main>
    );
  }

  const token = await getToken();
  let journeys: OperatorJourney[] = [];
  let liveJourneys: LiveJourney[] = [];
  let loadError = false;

  if (token) {
    try {
      [journeys, liveJourneys] = await Promise.all([
        getJson<OperatorJourney[]>('/operator/journeys', token),
        getJson<LiveJourney[]>('/operator/live-journeys', token),
      ]);
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
  const feed = summarizeLiveFeed(liveJourneys, Date.now());
  const queue = [
    ...feed.attentionJourneys.map((entry) => ({
      id: entry.item.journey.id,
      name: entry.item.journey.name,
      destination: entry.item.journey.destinationAddress ?? 'Destination pending',
      statusLabel: entry.status.attentionReasons.join(' · ') || 'Needs attention',
      tone: 'attention' as const,
      person: entry.status.leadName,
    })),
    ...[...live, ...scheduled, ...pending]
      .filter(
        (journey) =>
          !feed.attentionJourneys.some(
            (entry) => entry.item.journey.id === journey.id,
          ),
      )
      .slice(0, 8)
      .map((journey) => ({
        id: journey.id,
        name: journey.name,
        destination: journey.destinationAddress ?? 'Destination pending',
        statusLabel:
          journey.status === 'ACTIVE'
            ? 'On track'
            : formatSchedule(journey.scheduledFor),
        tone: journey.status === 'ACTIVE' ? ('healthy' as const) : ('neutral' as const),
        person: null,
      })),
  ].slice(0, 8);

  const reportingRatio =
    feed.visibleMembers > 0
      ? Math.round((feed.driversOnline / feed.visibleMembers) * 100)
      : null;

  return (
    <main className="dashboard-shell">
      <section className="dashboard-content overview-grid">
        {loadError ? (
          <div className="api-warning">
            The Tulink API is temporarily unavailable. Retry in a moment or
            contact support if the problem continues.
          </div>
        ) : null}

        {feed.attentionCount > 0 ? (
          <aside className="attention-banner">
            <div>
              <strong>
                {feed.attentionCount}{' '}
                {feed.attentionCount === 1 ? 'journey needs' : 'journeys need'}{' '}
                attention
              </strong>
              <p>{feed.reasons.join(' · ')}</p>
            </div>
            <Link className="tulink-button" href="/dashboard/live">
              Review queue
            </Link>
          </aside>
        ) : null}

        <div className="metric-grid">
          <article className="tulink-panel metric-card live">
            <p>Active journeys</p>
            <strong>{live.length}</strong>
            <span>Teams currently moving</span>
          </article>
          <article className="tulink-panel metric-card pending">
            <p>Exceptions</p>
            <strong>{feed.attentionCount}</strong>
            <span>Stale or offline live locations</span>
          </article>
          <article className="tulink-panel metric-card scheduled">
            <p>Drivers online</p>
            <strong>{feed.driversOnline}</strong>
            <span>Reporting from active journeys</span>
          </article>
        </div>

        <div className="overview-body">
          <section className="tulink-panel journey-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Operational queue</p>
                <h2>Priority work queue</h2>
              </div>
              <Link className="text-link" href="/dashboard/live">
                Open live tracking
              </Link>
            </div>

            {queue.length === 0 ? (
              <div className="empty-state">
                <h3>No open team journeys</h3>
                <p>
                  Add Tulink app users to this organization to attribute their
                  next journeys automatically.
                </p>
              </div>
            ) : (
              <div className="journey-list">
                {queue.map((row) => (
                  <article
                    className={`queue-row ${row.tone}`}
                    key={row.id}
                  >
                    <div>
                      <h3>{row.name}</h3>
                      <p>{row.destination}</p>
                    </div>
                    <div className="journey-meta">
                      <strong>{row.statusLabel}</strong>
                      {row.person ? <span>{row.person}</span> : null}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <aside className="workspace-snapshot">
            <p className="eyebrow">Workspace</p>
            <h2>Live snapshot</h2>
            <strong>{reportingRatio === null ? '—' : `${reportingRatio}%`}</strong>
            <p>
              {feed.visibleMembers === 0
                ? 'No live participants reporting yet'
                : 'Members reporting from active journeys'}
            </p>
            <div className="snapshot-bars" aria-hidden="true">
              <span style={{ width: `${Math.min(100, live.length * 12 + 24)}%` }} />
              <span style={{ width: `${Math.min(100, scheduled.length * 12 + 18)}%` }} />
              <span
                className="accent"
                style={{ width: `${Math.min(100, feed.attentionCount * 18 + 16)}%` }}
              />
              <span style={{ width: `${Math.min(100, pending.length * 12 + 20)}%` }} />
            </div>
            <small>
              {scheduled.length} scheduled · {pending.length} waiting to start
            </small>
          </aside>
        </div>
      </section>
    </main>
  );
}
