import type { ReactNode } from 'react';
import { OpsChrome } from '../ops-chrome';
import { getOpsChromeProps } from '../ops-context';

export default async function OrganizationProfileLayout({
  children,
}: {
  children: ReactNode;
}) {
  const chrome = await getOpsChromeProps();

  return (
    <OpsChrome orgLabel={chrome.orgLabel} operatorLabel={chrome.operatorLabel}>
      <div className="clerk-embed">{children}</div>
    </OpsChrome>
  );
}
