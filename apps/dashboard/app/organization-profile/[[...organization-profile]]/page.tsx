import { OrganizationProfile } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';

export default async function OrganizationProfilePage() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return <div style={{ padding: 48 }}>Clerk is not configured yet.</div>;
  }

  await auth.protect();

  return <OrganizationProfile afterLeaveOrganizationUrl="/" />;
}
