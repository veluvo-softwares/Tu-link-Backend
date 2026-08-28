'use client';

import {
  Buildings,
  ChartBar,
  House,
  MapTrifold,
  Path,
  UsersThree,
  X,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { OrganizationSwitcher, UserButton } from '@clerk/nextjs';

const navigation = [
  {
    href: '/dashboard',
    label: 'Overview',
    context: 'Monitor · Command center',
    exact: true,
    icon: House,
  },
  {
    href: '/dashboard/live',
    label: 'Live operations',
    context: 'Monitor · Map + work queue',
    icon: MapTrifold,
  },
  {
    href: '/dashboard/journeys',
    label: 'Journeys',
    context: 'Open work · History',
    icon: Path,
  },
  {
    href: '/dashboard/reports',
    label: 'Reports',
    context: 'Understand team performance',
    icon: ChartBar,
  },
  {
    href: '/dashboard/team',
    label: 'Team',
    context: 'People · Access',
    icon: UsersThree,
  },
  {
    href: '/organization-profile',
    label: 'Workspace',
    context: 'Configure with confidence',
    icon: Buildings,
  },
];

function pageMeta(pathname: string) {
  const match = navigation.find((item) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href),
  );
  return match ?? navigation[0];
}

export function OpsChrome({
  children,
  orgLabel,
  operatorLabel,
}: {
  children: ReactNode;
  orgLabel: string;
  operatorLabel: string;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const current = pageMeta(pathname);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  function isActive(href: string, exact?: boolean) {
    return exact ? pathname === href : pathname.startsWith(href);
  }

  return (
    <div className="ops-shell">
      <aside className={`ops-sidebar ${mobileOpen ? 'open' : ''}`}>
        <Link className="ops-brand" href="/dashboard" title={orgLabel}>
          <img className="ops-brand-logo" src="/brand/tulink-horizontal-reversed.webp" alt="Tu-Link" />
          <small>{orgLabel}</small>
        </Link>

        <nav aria-label="Operator navigation">
          {navigation.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href, item.exact);
            return (
              <Link
                aria-current={active ? 'page' : undefined}
                className={active ? 'active' : undefined}
                href={item.href}
                key={item.href}
              >
                <Icon aria-hidden="true" size={18} weight="bold" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <p className="ops-operator">{operatorLabel}</p>
      </aside>

      {mobileOpen ? (
        <button
          aria-label="Close navigation"
          className="ops-sidebar-backdrop"
          onClick={() => setMobileOpen(false)}
          type="button"
        />
      ) : null}

      <div className="ops-main">
        <header className="ops-topbar">
          <button
            aria-label="Open navigation"
            className="ops-menu"
            onClick={() => setMobileOpen(true)}
            type="button"
          >
            Menu
          </button>
          <Link className="ops-topbar-brand" href="/dashboard" aria-label="Tu-Link dashboard home">
            <img src="/brand/tulink-horizontal-reversed.webp" alt="Tu-Link" />
          </Link>
          <div className="ops-topbar-title">
            <h1>{current.label}</h1>
            <p>{current.context}</p>
          </div>
          <div className="ops-topbar-controls">
            <OrganizationSwitcher
              afterCreateOrganizationUrl="/create-organization"
              createOrganizationMode="navigation"
              createOrganizationUrl="/create-organization"
              appearance={{
                elements: {
                  rootBox: 'ops-org-switcher',
                  organizationSwitcherTrigger: 'ops-org-switcher-trigger',
                },
              }}
              organizationProfileUrl="/organization-profile"
            />
            <UserButton afterSignOutUrl="/" />
            {mobileOpen ? (
              <button
                aria-label="Close navigation"
                className="ops-menu-close"
                onClick={() => setMobileOpen(false)}
                type="button"
              >
                <X size={18} />
              </button>
            ) : null}
          </div>
        </header>
        <div className="ops-content">{children}</div>
      </div>
    </div>
  );
}
