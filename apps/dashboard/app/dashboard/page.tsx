import { auth } from '@clerk/nextjs/server';
import { tulinkTokens } from '@tulink/ui';

const fleetCards = [
  {
    label: 'Active convoys',
    value: '12',
    detail: 'Scoped to the selected organization',
  },
  {
    label: 'Open alerts',
    value: '4',
    detail: 'Lag and arrival events awaiting review',
  },
  {
    label: 'Drivers on route',
    value: '31',
    detail: 'Latest known positions updating live',
  },
];

export default async function DashboardPage() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return (
      <main style={{ color: tulinkTokens.colors.ivory, padding: 48 }}>
        <h1>Dashboard scaffold ready</h1>
        <p>
          Set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` to
          enable Clerk auth for this route.
        </p>
      </main>
    );
  }

  await auth.protect();

  return (
    <main
      style={{
        background: '#0b0f14',
        color: tulinkTokens.colors.ivory,
        minHeight: '100vh',
        padding: '36px 28px 72px',
      }}
    >
      <section style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div className="tulink-panel" style={{ padding: 28 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
            <div>
              <p style={{ margin: 0, color: 'rgba(248, 245, 239, 0.72)' }}>
                Organization dashboard
              </p>
              <h1
                style={{
                  fontFamily: tulinkTokens.fonts.display,
                  fontSize: 'clamp(2.2rem, 5vw, 4rem)',
                  margin: '10px 0 0',
                }}
              >
                Fleet visibility at a glance
              </h1>
            </div>
            <div
              style={{
                alignSelf: 'flex-start',
                border: '1px solid rgba(232, 216, 184, 0.12)',
                borderRadius: 999,
                color: tulinkTokens.colors.electricRed,
                fontFamily: tulinkTokens.fonts.badge,
                letterSpacing: 3,
                padding: '10px 14px',
              }}
            >
              LIVE
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gap: 18,
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              marginTop: 28,
            }}
          >
            {fleetCards.map((card) => (
              <article
                key={card.label}
                className="tulink-panel"
                style={{ padding: 22 }}
              >
                <p style={{ margin: 0, opacity: 0.7 }}>{card.label}</p>
                <div
                  style={{
                    color: tulinkTokens.colors.electricRed,
                    fontFamily: tulinkTokens.fonts.display,
                    fontSize: '3rem',
                    marginTop: 10,
                  }}
                >
                  {card.value}
                </div>
                <p style={{ marginBottom: 0, opacity: 0.8 }}>{card.detail}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
