import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { operatorFetch } from '../../operator-api';

interface OperatorJourney {
  id: string;
  name: string;
  status: 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  scheduledFor: string | null;
  destinationAddress: string | null;
  createdAt: string;
}

interface ApiResponse<T> {
  data: T;
}

function formatWhen(value: string | null, fallback: string) {
  if (!value) return fallback;
  return new Intl.DateTimeFormat('en-KE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Nairobi',
  }).format(new Date(value));
}

export default async function JourneysPage() {
  await auth.protect();
  const { getToken, orgId } = await auth();

  if (!orgId) {
    return (
      <main className="dashboard-shell">
        <section className="tulink-panel empty-state">
          <p className="eyebrow">Organization required</p>
          <h1>Select an organization to see its journeys</h1>
        </section>
      </main>
    );
  }

  const token = await getToken();
  let journeys: OperatorJourney[] = [];
  let loadError = false;

  if (token) {
    try {
      const response = await operatorFetch('/operator/journeys', token);
      if (!response.ok) throw new Error(String(response.status));
      const payload = (await response.json()) as ApiResponse<OperatorJourney[]>;
      journeys = payload.data;
    } catch {
      loadError = true;
    }
  } else {
    loadError = true;
  }

  return (
    <main className="dashboard-shell">
      <section className="dashboard-content">
        {loadError ? (
          <div className="api-warning">
            Journey history could not be loaded from the Tulink API.
          </div>
        ) : null}

        <section className="tulink-panel journey-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Journey history</p>
              <h2>All organization journeys</h2>
            </div>
            <Link className="text-link" href="/dashboard/live">
              Live operations
            </Link>
          </div>

          {journeys.length === 0 ? (
            <div className="empty-state">
              <h3>No journeys yet</h3>
              <p>
                Journeys created in the Tulink app appear here once they are
                attributed to this organization.
              </p>
            </div>
          ) : (
            <div className="journey-list">
              {journeys.map((journey) => (
                <article className="queue-row" key={journey.id}>
                  <div>
                    <h3>{journey.name}</h3>
                    <p>{journey.destinationAddress ?? 'Destination pending'}</p>
                  </div>
                  <div className="journey-meta">
                    <strong>{journey.status}</strong>
                    <span>
                      {formatWhen(journey.scheduledFor, formatWhen(journey.createdAt, ''))}
                    </span>
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
