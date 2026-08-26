import { auth } from '@clerk/nextjs/server';
import { SignInButton, SignUpButton } from '@clerk/nextjs';
import Link from 'next/link';

const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const operatorApiBaseUrl =
  process.env.OPERATOR_API_BASE_URL ?? 'http://localhost:3001';

async function syncOperatorSession() {
  const clerkAuth = await auth();
  const sessionToken = await clerkAuth.getToken();

  if (!sessionToken) {
    return null;
  }

  try {
    const response = await fetch(`${operatorApiBaseUrl}/operator/session`, {
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${sessionToken}`,
      },
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as {
      userId: string | null;
      sessionId: string | null;
      orgId: string | null;
      orgRole: string | null;
      orgSlug: string | null;
      sync: {
        organizationCount: number;
        organizations: Array<{
          clerkOrgId: string;
          name: string;
          localOrganizationId: string;
          membershipId: string;
          role: string;
          status: string;
        }>;
      } | null;
    };
  } catch {
    return null;
  }
}

export default async function DashboardHomePage() {
  const session = clerkPublishableKey ? await syncOperatorSession() : null;

  return (
    <main className="public-home">
      <p className="eyebrow">Tu-Link · B2B operator experience</p>
      <h1>Operator dashboard, rebuilt around live work.</h1>
      <p className="page-intro">
        Monitor active convoys, exceptions, and team access for the
        organization you are signed into.
      </p>
      {session?.sync ? (
        <p className="muted-copy">
          Backend sync confirmed for{' '}
          {session.orgSlug || session.orgId || 'the active organization'}.
          {session.sync.organizationCount > 0
            ? ` Mirrored ${session.sync.organizationCount} organization membership${
                session.sync.organizationCount === 1 ? '' : 's'
              }.`
            : ' No organization memberships were returned for this session.'}
        </p>
      ) : null}
      <div className="empty-state-actions">
        {clerkPublishableKey ? (
          session ? (
            <Link className="tulink-button" href="/dashboard">
              Open operations
            </Link>
          ) : (
            <>
              <SignInButton mode="modal">
                <button className="tulink-button tulink-button-ghost">
                  Sign in
                </button>
              </SignInButton>
              <SignUpButton mode="modal">
                <button className="tulink-button">Create account</button>
              </SignUpButton>
            </>
          )
        ) : (
          <>
            <a className="tulink-button tulink-button-ghost" href="/sign-in">
              Sign in
            </a>
            <a className="tulink-button" href="/sign-up">
              Create account
            </a>
          </>
        )}
      </div>
    </main>
  );
}
