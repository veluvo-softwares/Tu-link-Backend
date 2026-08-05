'use client';

import { House, List, MapTrifold, UsersThree, X } from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const navigation = [
  {
    href: '/dashboard',
    label: 'Overview',
    description: 'Journey status and operational queue',
    exact: true,
    icon: House,
  },
  {
    href: '/dashboard/live',
    label: 'Live map',
    description: 'Current journeys and member locations',
    icon: MapTrifold,
  },
  {
    href: '/dashboard/team',
    label: 'Team & access',
    description: 'Mobile members and operator visibility',
    icon: UsersThree,
  },
];

export function AppNavigation() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    firstLinkRef.current?.focus();

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMobileOpen(false);
        triggerRef.current?.focus();
        return;
      }

      if (event.key !== 'Tab') return;
      const panel = document.getElementById('mobile-dashboard-navigation');
      const focusable = panel?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [mobileOpen]);

  function isActive(item: (typeof navigation)[number]) {
    return item.exact ? pathname === item.href : pathname.startsWith(item.href);
  }

  return (
    <>
      <nav className="app-nav" aria-label="Dashboard navigation">
        {navigation.map((item) => (
          <Link
            aria-current={isActive(item) ? 'page' : undefined}
            className={isActive(item) ? 'active' : undefined}
            href={item.href}
            key={item.href}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <button
        aria-controls="mobile-dashboard-navigation"
        aria-expanded={mobileOpen}
        aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
        className="mobile-nav-trigger"
        onClick={() => setMobileOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >
        <List aria-hidden="true" size={23} weight="bold" />
      </button>

      {mobileOpen
        ? createPortal(
            <div
              className="mobile-nav-layer"
              onMouseDown={(event) => {
                if (event.target !== event.currentTarget) return;
                setMobileOpen(false);
                triggerRef.current?.focus();
              }}
            >
              <aside
                aria-modal="true"
                aria-label="Mobile dashboard navigation"
                className="mobile-nav-panel"
                id="mobile-dashboard-navigation"
                role="dialog"
              >
                <div className="mobile-nav-heading">
                  <div>
                    <p>Tu-Link operations</p>
                    <strong>Navigation</strong>
                  </div>
                  <button
                    aria-label="Close navigation"
                    onClick={() => {
                      setMobileOpen(false);
                      triggerRef.current?.focus();
                    }}
                    type="button"
                  >
                    <X aria-hidden="true" size={22} />
                  </button>
                </div>

                <nav aria-label="Mobile primary navigation">
                  {navigation.map((item, index) => {
                    const Icon = item.icon;
                    const active = isActive(item);
                    return (
                      <Link
                        aria-current={active ? 'page' : undefined}
                        className={active ? 'active' : undefined}
                        href={item.href}
                        key={item.href}
                        ref={index === 0 ? firstLinkRef : undefined}
                      >
                        <Icon aria-hidden="true" size={22} weight="bold" />
                        <span>
                          <strong>{item.label}</strong>
                          <small>{item.description}</small>
                        </span>
                      </Link>
                    );
                  })}
                </nav>

                <p className="mobile-nav-footnote">
                  Select an area to continue working in the active organization.
                </p>
              </aside>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
