import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ClerkProvider,
  OrganizationSwitcher,
  SignInButton,
  SignUpButton,
  SignedIn,
  SignedOut,
  UserButton,
} from '@clerk/nextjs';
import type { ReactNode } from 'react';
import './globals.css';
import 'mapbox-gl/dist/mapbox-gl.css';
import { tulinkTokens } from '@tulink/ui';

export const metadata: Metadata = {
  title: 'Tulink Operator Dashboard',
  description: 'Operator dashboard for fleet visibility and alerts.',
};

const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  if (!clerkPublishableKey) {
    return (
      <html lang="en">
        <body>{children}</body>
      </html>
    );
  }

  return (
    <html lang="en">
      <body>
        <ClerkProvider publishableKey={clerkPublishableKey}>
          <header
            style={{
              alignItems: 'center',
              backdropFilter: 'blur(18px)',
              background: 'rgba(11, 15, 20, 0.72)',
              borderBottom: '1px solid rgba(232, 216, 184, 0.12)',
              display: 'flex',
              justifyContent: 'space-between',
              gap: 16,
              padding: '18px 28px',
              position: 'sticky',
              top: 0,
              zIndex: 20,
            }}
          >
            <div>
              <div
                style={{
                  color: tulinkTokens.colors.electricRed,
                  fontFamily: tulinkTokens.fonts.badge,
                  fontSize: 14,
                  letterSpacing: 5,
                }}
              >
                TULINK
              </div>
              <div style={{ color: 'rgba(248, 245, 239, 0.7)', fontSize: 13 }}>
                Operator dashboard
              </div>
            </div>

            <div style={{ alignItems: 'center', display: 'flex', gap: 12 }}>
              <SignedIn>
                <nav className="app-nav" aria-label="Dashboard navigation">
                  <Link href="/dashboard">Operations</Link>
                  <Link href="/dashboard/team">Team</Link>
                  <Link href="/dashboard/live">Live map</Link>
                </nav>
                <OrganizationSwitcher
                  afterCreateOrganizationUrl="/create-organization"
                  organizationProfileUrl="/organization-profile"
                />
                <UserButton afterSignOutUrl="/" />
              </SignedIn>
              <SignedOut>
                <SignInButton mode="modal">
                  <button className="tulink-button tulink-button-ghost">
                    Sign in
                  </button>
                </SignInButton>
                <SignUpButton mode="modal">
                  <button className="tulink-button">Create account</button>
                </SignUpButton>
              </SignedOut>
            </div>
          </header>
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
