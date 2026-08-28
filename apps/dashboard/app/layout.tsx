import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import Image from 'next/image';
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
  metadataBase: new URL('https://dashboard.tulink.xyz'),
  applicationName: 'Tu-Link Operations',
  title: {
    default: 'Tu-Link Operations',
    template: '%s | Tu-Link Operations',
  },
  description: 'Live journey visibility for Tu-Link organizations.',
  manifest: '/site.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-48x48.png', sizes: '48x48', type: 'image/png' },
    ],
    apple: [
      {
        url: '/apple-touch-icon.png',
        sizes: '180x180',
        type: 'image/png',
      },
    ],
    other: [
      {
        rel: 'mask-icon',
        url: '/safari-pinned-tab.svg',
        color: '#075261',
      },
    ],
  },
  openGraph: {
    type: 'website',
    url: 'https://dashboard.tulink.xyz',
    siteName: 'Tu-Link Operations',
    title: 'Tu-Link Operations',
    description: 'Live journey visibility for Tu-Link organizations.',
    images: [
      {
        url: '/open-graph-1200x630.png',
        width: 1200,
        height: 630,
        alt: 'Tu-Link',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Tu-Link Operations',
    description: 'Live journey visibility for Tu-Link organizations.',
    images: ['/open-graph-1200x630.png'],
  },
  other: {
    'msapplication-config': '/browserconfig.xml',
    'msapplication-TileColor': '#075261',
  },
};

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#075261',
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
            <Link
              aria-label="Tu-Link Operations dashboard"
              className="brand-lockup"
              href="/dashboard"
            >
              <Image
                alt=""
                className="brand-logo"
                height={161}
                priority
                src="/brand/tulink-horizontal-reversed.webp"
                width={640}
              />
              <span className="brand-context">Operations</span>
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
