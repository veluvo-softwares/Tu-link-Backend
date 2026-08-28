import { CreateOrganization } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';

export default async function CreateOrganizationPage() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return <div style={{ padding: 48 }}>Clerk is not configured yet.</div>;
  }

  await auth.protect();

  return (
    <main className="organization-onboarding">
      <section className="organization-onboarding-intro">
        <p className="eyebrow">Workspace setup · Step 1 of 3</p>
        <h1>Create your operations workspace</h1>
        <p>
          Your workspace keeps journeys, live locations, and team access scoped
          to the right organization.
        </p>
        <div className="organization-onboarding-promise">
          <strong>What happens next</strong>
          <span>Invite dashboard operators</span>
          <span>Connect your Tulink team</span>
          <span>Start monitoring live work</span>
        </div>
      </section>

      <section
        aria-label="Create an organization"
        className="organization-onboarding-form"
      >
        <CreateOrganization
          afterCreateOrganizationUrl="/dashboard"
          appearance={{
            variables: {
              borderRadius: '0.75rem',
              colorBackground: '#ffffff',
              colorDanger: '#c83d24',
              colorInputBackground: '#ffffff',
              colorInputText: '#1a1a19',
              colorPrimary: '#075261',
              colorSuccess: '#1e8e63',
              colorText: '#1a1a19',
              colorTextSecondary: '#52666a',
              fontFamily: 'var(--font-manrope), Manrope, sans-serif',
            },
            elements: {
              rootBox: 'tulink-clerk-root',
              cardBox: 'tulink-clerk-card-box',
              card: 'tulink-clerk-card',
              headerTitle: 'tulink-clerk-title',
              headerSubtitle: 'tulink-clerk-subtitle',
              formButtonPrimary: 'tulink-clerk-primary',
              formFieldInput: 'tulink-clerk-input',
              formFieldLabel: 'tulink-clerk-label',
              footer: 'tulink-clerk-footer',
            },
          }}
        />
      </section>
    </main>
  );
}
