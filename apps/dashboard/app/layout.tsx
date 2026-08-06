import type { Metadata } from 'next';
import localFont from 'next/font/local';
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
import { AppNavigation } from './app-navigation';
import './globals.css';

export const metadata: Metadata = {
  title: 'Tu-Link Operations',
  description: 'Live journey visibility for Tu-Link organizations.',
};

const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const inter = localFont({
  src: './fonts/Inter-Variable.ttf',
  variable: '--font-inter',
  weight: '100 900',
});
const rajdhani = localFont({
  src: [
    {
      path: './fonts/Rajdhani-Medium.ttf',
      weight: '500',
    },
    {
      path: './fonts/Rajdhani-SemiBold.ttf',
      weight: '600',
    },
    {
      path: './fonts/Rajdhani-Bold.ttf',
      weight: '700',
    },
  ],
  variable: '--font-rajdhani',
});

const fontVariables = `${inter.variable} ${rajdhani.variable}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  if (!clerkPublishableKey) {
    return (
      <html lang="en">
        <body className={fontVariables}>{children}</body>
      </html>
    );
  }

  return (
    <html lang="en">
      <body className={fontVariables}>
        <ClerkProvider publishableKey={clerkPublishableKey}>
          <header className="command-header">
            <Link className="brand-lockup" href="/dashboard">
              <span>
                <strong>TU-LINK</strong>
                <small>Operations</small>
              </span>
            </Link>

            <SignedIn>
              <AppNavigation />
            </SignedIn>

            <div className="header-controls">
              <SignedIn>
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
