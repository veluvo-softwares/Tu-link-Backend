import type { ReactNode } from 'react';
import { OpsChrome } from '../ops-chrome';
import { getOpsChromeProps } from '../ops-context';

export default async function CreateOrganizationLayout({
  children,
}: {
  children: ReactNode;
}) {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return (
      <main className="dashboard-shell">
        <section className="tulink-panel empty-state">
          <p className="eyebrow">Dashboard configuration required</p>
          <h1>Clerk environment keys are missing.</h1>
        </section>
      </main>
    );
  }

  const chrome = await getOpsChromeProps();

  return (
    <OpsChrome orgLabel={chrome.orgLabel} operatorLabel={chrome.operatorLabel}>
      <div className="clerk-embed">{children}</div>
    </OpsChrome>
  );
}
