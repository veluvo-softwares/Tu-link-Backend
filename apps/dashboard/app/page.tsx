import { auth } from '@clerk/nextjs/server';
import { tulinkTokens } from '@tulink/ui';
import { SignInButton, SignUpButton } from '@clerk/nextjs';

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
    <main
      style={{
        background:
          'radial-gradient(circle at top left, rgba(230, 57, 70, 0.2), transparent 30%), radial-gradient(circle at right, rgba(232, 216, 184, 0.12), transparent 28%), #0b0f14',
        color: tulinkTokens.colors.ivory,
        minHeight: '100vh',
        padding: '84px 32px 72px',
      }}
    >
      <section style={{ maxWidth: 1120, margin: '0 auto' }}>
        <p style={{ fontFamily: tulinkTokens.fonts.badge, letterSpacing: 4 }}>
          TULINK
        </p>
        <h1
          style={{
            fontFamily: tulinkTokens.fonts.display,
            fontSize: 'clamp(3rem, 8vw, 6rem)',
            lineHeight: 0.95,
            margin: '16px 0',
            maxWidth: 840,
          }}
        >
          Operator dashboard scaffold for fleet visibility and alerts
        </h1>
        <p style={{ fontSize: '1.125rem', maxWidth: 720, opacity: 0.84 }}>
          This monorepo now has a Clerk-ready dashboard shell. The next pass
          will wire in operator auth, organizations, and the fleet views that
          managers use to watch active rides in real time.
        </p>
        {session?.sync ? (
          <p
            style={{
              color: 'rgba(248, 245, 239, 0.72)',
              marginTop: 20,
              maxWidth: 720,
            }}
          >
            Backend sync confirmed for{' '}
            {session.orgSlug || session.orgId || 'the active organization'}.
            {session.sync.organizationCount > 0
              ? ` Mirrored ${session.sync.organizationCount} organization membership${
                  session.sync.organizationCount === 1 ? '' : 's'
                } into Postgres.`
              : ' No organization memberships were returned for this session.'}
          </p>
        ) : null}
        <div style={{ display: 'flex', gap: 12, marginTop: 32, flexWrap: 'wrap' }}>
          {clerkPublishableKey ? (
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
      </section>
    </main>
  );
}
