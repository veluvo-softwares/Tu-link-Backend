import { auth } from '@clerk/nextjs/server';
import { operatorFetch } from '../../operator-api';
import { reportFields, type JourneyReport } from '../../journey-reports';
import { ReportsBrowser } from './reports-browser';

export default async function ReportsPage() {
  await auth.protect();
  const { getToken, orgId } = await auth();
  if (!orgId)
    return (
      <main className="dashboard-shell">
        <section className="tulink-panel empty-state">
          <h1>Select an organization to view reports</h1>
        </section>
      </main>
    );
  let journeys: JourneyReport[];
  try {
    const token = await getToken();
    if (!token) throw new Error('Session unavailable');
    const response = await operatorFetch('/operator/journeys', token);
    if (!response.ok) throw new Error('Request failed');
    const payload = await response.json();
    if (!Array.isArray(payload.data)) throw new Error('Invalid response');
    journeys = payload.data.map(reportFields);
  } catch {
    return (
      <main className="dashboard-shell">
        <section className="tulink-panel empty-state" role="alert">
          <h1>Reports could not be loaded</h1>
          <p>Please try again. Your journey history has not changed.</p>
          <a className="tulink-button" href="/dashboard/reports">
            Try again
          </a>
        </section>
      </main>
    );
  }
  return <ReportsBrowser journeys={journeys} />;
}
