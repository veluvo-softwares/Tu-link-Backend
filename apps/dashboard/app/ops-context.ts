import { auth, clerkClient } from '@clerk/nextjs/server';

const fallback = {
  orgLabel: 'Workspace',
  operatorLabel: 'operator',
} as const;

function claimText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function formatOrgSlug(slug: string | null | undefined) {
  if (!slug?.trim()) return fallback.orgLabel;
  const withoutTrailingId = slug.replace(/-\d{8,}$/, '');
  const words = withoutTrailingId.split('-').filter(Boolean);
  if (words.length === 0) return fallback.orgLabel;
  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export async function getOpsChromeProps() {
  try {
    const { orgSlug, orgRole, orgId, sessionClaims } = await auth();
    const claims = sessionClaims as
      | { first_name?: unknown; firstName?: unknown }
      | null
      | undefined;
    const firstName =
      claimText(claims?.first_name) ?? claimText(claims?.firstName);
    const role = orgRole?.replace(/^org:/, '') ?? fallback.operatorLabel;

    let orgLabel = formatOrgSlug(orgSlug);
    if (orgId) {
      try {
        const client = await clerkClient();
        const organization = await client.organizations.getOrganization({
          organizationId: orgId,
        });
        const name = organization.name?.trim();
        if (name) orgLabel = name;
      } catch {
        // Keep the formatted slug when the Clerk Backend API is unavailable.
      }
    }

    return {
      orgLabel,
      operatorLabel: firstName ? `${firstName} · ${role}` : role,
    };
  } catch {
    return { ...fallback };
  }
}
