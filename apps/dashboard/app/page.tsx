import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { ScrollReveal } from './scroll-reveal';

const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const operatorApiBaseUrl =
  process.env.TULINK_API_URL ?? 'http://localhost:3000';

type LandingSession = {
  userId: string | null;
  orgId: string | null;
  orgSlug: string | null;
  sync: {
    organizationCount: number;
  } | null;
};

type LandingState = {
  isSignedIn: boolean;
  apiError: boolean;
  session: LandingSession | null;
};

async function getLandingState(): Promise<LandingState> {
  if (!clerkPublishableKey) {
    return { isSignedIn: false, apiError: false, session: null };
  }

  const clerkAuth = await auth();
  if (!clerkAuth.userId) {
    return { isSignedIn: false, apiError: false, session: null };
  }

  const sessionToken = await clerkAuth.getToken();

  if (!sessionToken) {
    return {
      isSignedIn: true,
      apiError: true,
      session: {
        userId: clerkAuth.userId,
        orgId: clerkAuth.orgId ?? null,
        orgSlug: clerkAuth.orgSlug ?? null,
        sync: null,
      },
    };
  }

  try {
    const response = await fetch(`${operatorApiBaseUrl}/operator/session`, {
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${sessionToken}`,
      },
    });

    if (!response.ok) {
      return {
        isSignedIn: true,
        apiError: true,
        session: {
          userId: clerkAuth.userId,
          orgId: clerkAuth.orgId ?? null,
          orgSlug: clerkAuth.orgSlug ?? null,
          sync: null,
        },
      };
    }

    const session = (await response.json()) as LandingSession;
    return { isSignedIn: true, apiError: false, session };
  } catch {
    return {
      isSignedIn: true,
      apiError: true,
      session: {
        userId: clerkAuth.userId,
        orgId: clerkAuth.orgId ?? null,
        orgSlug: clerkAuth.orgSlug ?? null,
        sync: null,
      },
    };
  }
}

export default async function DashboardHomePage() {
  const state = await getLandingState();
  const hasOrganization = Boolean(state.session?.orgId);

  return (
    <main className="public-site">
      <section className="public-hero">
        <div className="public-hero-copy">
          <p className="hero-brand"><img src="/brand/tulink-horizontal-reversed.webp" alt="Tu-Link" /><span>Operator command center</span></p>
          <h1>Know what is moving. Act before it slips.</h1>
          <p className="public-hero-intro">
            One calm workspace for live journeys, location exceptions, and the
            people who keep every route on track.
          </p>
          <div className="public-hero-actions">
            {state.isSignedIn ? (
              hasOrganization ? (
                <Link className="tulink-button" href="/dashboard">
                  Open operations
                </Link>
              ) : (
                <Link className="tulink-button" href="/create-organization">
                  Set up workspace
                </Link>
              )
            ) : (
              <>
                <Link className="tulink-button" href="/sign-up">
                  Create account
                </Link>
                <Link className="tulink-button tulink-button-ghost" href="/sign-in">
                  Sign in
                </Link>
              </>
            )}
          </div>
          {state.apiError ? (
            <p className="public-status public-status-warning" role="status">
              Your account is signed in, but the operations service is not
              responding yet. You can retry from the dashboard.
            </p>
          ) : hasOrganization ? (
            <p className="public-status" role="status">
              Connected to {state.session?.orgSlug || 'your active workspace'}.
            </p>
          ) : null}
          <div className="public-hero-proof" aria-label="Product benefits">
            <span>Live visibility</span>
            <span>Exception-first alerts</span>
            <span>Organization-ready</span>
          </div>
        </div>

        <div className="public-hero-preview" aria-label="Operator dashboard preview">
          <div className="preview-window-bar">
            <span className="preview-dot preview-dot-red" />
            <span className="preview-dot preview-dot-yellow" />
            <span className="preview-dot preview-dot-green" />
            <span className="preview-window-label">Tu-Link Operations</span>
            <span className="preview-live-pill">Live</span>
          </div>
          <div className="preview-content">
            <div className="preview-sidebar">
              <img className="preview-logo" src="/brand/tulink-horizontal-reversed.webp" alt="Tu-Link Operations" />
              <div className="preview-nav-item active">Overview</div>
              <div className="preview-nav-item">Live operations</div>
              <div className="preview-nav-item">Journeys</div>
              <div className="preview-nav-item">Team</div>
            </div>
            <div className="preview-main">
              <p className="preview-eyebrow">Today · command center</p>
              <h2>Good morning, operator.</h2>
              <div className="preview-metric-grid">
                <div><strong>24</strong><span>active journeys</span></div>
                <div><strong>03</strong><span>need attention</span></div>
                <div><strong>96%</strong><span>reporting normally</span></div>
              </div>
              <div className="preview-route-card">
                <div><span className="preview-route-status">ATTENTION</span><strong>Nairobi → Naivasha</strong></div>
                <span>2 members delayed · Open journey →</span>
              </div>
              <div className="preview-route-card healthy">
                <div><span className="preview-route-status">ON TRACK</span><strong>Westlands → CBD</strong></div>
                <span>8 members reporting normally</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="public-product-story" id="capabilities">
        <ScrollReveal className="public-story-intro">
          <p className="eyebrow">The operator layer on top of Tu-Link</p>
          <h2>Turn movement into decisions.</h2>
          <p>The app keeps journeys moving. The dashboard gives your operations team the shared context, controls, and accountability to run them well.</p>
        </ScrollReveal>
        <div className="operator-feature-stack">
          <ScrollReveal className="operator-feature" delay={80}>
            <div className="operator-feature-copy">
              <span className="story-number">01 · Command center</span>
              <h3>Start every shift with the live picture.</h3>
              <p>See active journeys, reporting health, and the priority queue at a glance. Your team knows what is normal before deciding what needs intervention.</p>
            </div>
            <div className="feature-ui feature-ui-overview" aria-label="Dashboard overview feature preview">
              <div className="feature-ui-topline"><span>Overview</span><b>Live now</b></div>
              <div className="feature-ui-metrics"><span><b>24</b> active journeys</span><span><b>03</b> need attention</span><span><b>96%</b> reporting normally</span></div>
              <div className="feature-ui-queue"><i /> Nairobi → Naivasha <em>Attention</em></div>
              <div className="feature-ui-queue healthy"><i /> Westlands → CBD <em>On track</em></div>
            </div>
          </ScrollReveal>
          <ScrollReveal className="operator-feature operator-feature-flipped" delay={100}>
            <div className="operator-feature-copy">
              <span className="story-number">02 · Live operations</span>
              <h3>Move from signal to action in one view.</h3>
              <p>Open the live map, filter by status, and focus the team on the journeys that need help—without hunting through separate tools.</p>
            </div>
            <div className="feature-ui feature-ui-map" aria-label="Live operations map feature preview">
              <div className="feature-ui-map-lines"><span /><span /><span /></div>
              <div className="feature-map-pin pin-one">WK</div><div className="feature-map-pin pin-two">AK</div><div className="feature-map-pin pin-three">MJ</div>
              <div className="feature-map-drawer"><b>Nairobi Night Run</b><span>3 riders · 1 needs attention</span><strong>Open journey →</strong></div>
            </div>
          </ScrollReveal>
          <ScrollReveal className="operator-feature" delay={120}>
            <div className="operator-feature-copy">
              <span className="story-number">03 · Team and workspace</span>
              <h3>Give every operator the right level of access.</h3>
              <p>Bring workspace membership, delegated visibility, and ownership into one controlled layer as your operations team grows.</p>
              <Link className="text-link" href={state.isSignedIn ? '/create-organization' : '/sign-up'}>Build your workspace →</Link>
            </div>
            <div className="feature-ui feature-ui-team" aria-label="Workspace team management feature preview">
              <div className="feature-ui-topline"><span>Workspace access</span><b>4 operators</b></div>
              <div className="feature-team-row"><i>WK</i><span><b>Wesley K.</b> Administrator</span><em>Owner</em></div>
              <div className="feature-team-row"><i>AK</i><span><b>Alex K.</b> Live operations</span><em>Operator</em></div>
              <div className="feature-team-row"><i>MJ</i><span><b>Mike J.</b> Reports only</span><em>Viewer</em></div>
            </div>
          </ScrollReveal>
        </div>
      </section>

      <section className="public-capabilities">
        <div className="public-section-heading">
          <p className="eyebrow">Built for the shift ahead</p>
          <h2>Everything your operators need in one view.</h2>
        </div>
        <div className="public-capability-grid">
          <article className="public-reveal public-reveal-delay-1"><span>01</span><h3>See the live picture</h3><p>Track journeys, people, routes, and reporting health without switching contexts.</p></article>
          <article className="public-reveal public-reveal-delay-2"><span>02</span><h3>Resolve exceptions quickly</h3><p>Surface stale locations and delayed members before they become customer-facing problems.</p></article>
          <article className="public-reveal public-reveal-delay-3"><span>03</span><h3>Run as one team</h3><p>Keep workspace access, delegated visibility, and operational ownership in sync.</p></article>
        </div>
      </section>

      <section className="public-cta-panel">
        <div><p className="eyebrow">Start with a clear workspace</p><h2>Your next shift starts here.</h2></div>
        <Link
          className="tulink-button"
          href={
            state.isSignedIn
              ? hasOrganization
                ? '/dashboard'
                : '/create-organization'
              : '/sign-up'
          }
        >
          {state.isSignedIn
            ? hasOrganization
              ? 'Open operations'
              : 'Set up workspace'
            : 'Get started'}
        </Link>
      </section>
    </main>
  );
}
