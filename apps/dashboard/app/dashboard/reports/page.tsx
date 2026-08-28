import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';

export default async function ReportsPage() {
  await auth.protect();

  return (
    <main className="dashboard-shell">
      <section className="dashboard-content">
        <section className="tulink-panel empty-state">
          <p className="eyebrow">Understand team performance</p>
          <h1>Reports are not in the operator API yet</h1>
          <p>
            This workspace does not expose historical performance, on-time
            arrival, or shift reports. Live exceptions and journey lists are
            available from Overview and Live operations.
          </p>
          <div className="empty-state-actions">
            <Link className="tulink-button" href="/dashboard">
              Overview
            </Link>
            <Link className="tulink-button tulink-button-ghost" href="/dashboard/live">
              Live operations
            </Link>
          </div>
        </section>
      </section>
    </main>
  );
}
