import type { Metadata, Viewport } from 'next';
import { Manrope } from 'next/font/google';
import {
  ClerkProvider,
  SignInButton,
  SignUpButton,
  SignedOut,
} from '@clerk/nextjs';
import type { ReactNode } from 'react';
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
  colorScheme: 'light',
  themeColor: '#075261',
};

const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-manrope',
  weight: ['400', '500', '600', '700', '800'],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  if (!clerkPublishableKey) {
    return (
      <html lang="en">
        <body className={`${manrope.variable} ${manrope.className}`}>{children}</body>
      </html>
    );
  }

  return (
    <html lang="en">
      <body className={`${manrope.variable} ${manrope.className}`}>
        <ClerkProvider
          publishableKey={clerkPublishableKey}
          signInFallbackRedirectUrl="/dashboard"
          signInUrl="/sign-in"
          signUpFallbackRedirectUrl="/dashboard"
          signUpUrl="/sign-up"
        >
          <SignedOut>
            <header className="public-header">
              <a className="ops-brand public" href="/">
                <strong>TU-LINK</strong>
                <small>Operations</small>
              </a>
              <div className="header-controls">
                <SignInButton mode="modal">
                  <button className="tulink-button tulink-button-ghost">
                    Sign in
                  </button>
                </SignInButton>
                <SignUpButton mode="modal">
                  <button className="tulink-button">Create account</button>
                </SignUpButton>
              </div>
            </header>
          </SignedOut>
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
