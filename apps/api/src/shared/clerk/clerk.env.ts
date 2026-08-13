/**
 * Clerk instance resolution and validation.
 *
 * The deployed dashboard (https://dashboard.tulink.xyz) runs against a Clerk
 * PRODUCTION instance; local development runs against a Clerk DEVELOPMENT
 * instance. The two are entirely separate Clerk tenants -- they share no users,
 * no organizations, and no signing secrets -- so a key from one is meaningless
 * to the other.
 *
 * Nothing in the Clerk SDK enforces that the keys you supply are internally
 * consistent, and a mismatch does not fail loudly: it surfaces later as
 * every request 401-ing, or as webhooks silently failing verification. Since
 * the keys live in three separate places (local .env, the droplet .env, and
 * the NEXT_PUBLIC_* GitHub secret baked into the dashboard image), that
 * mismatch is the most likely way this setup breaks. Validate at boot instead.
 */

export type ClerkInstanceKind = 'development' | 'production';

export interface ClerkEnvironment {
  /** Which Clerk tenant these credentials belong to. */
  instance: ClerkInstanceKind;
  secretKey: string;
  publishableKey: string;
  /**
   * Origins allowed to present session tokens. Empty only outside production,
   * where Clerk's own default (accept any party) is acceptable.
   */
  authorizedParties: string[];
  /** Present when org-sync webhooks are configured. */
  webhookSigningSecret?: string;
}

/**
 * Clerk key prefixes encode their own instance kind, e.g. `sk_live_...` and
 * `pk_test_...`. That is the only reliable way to tell the tenants apart
 * offline -- the rest of the key is opaque base64.
 */
function classifyKey(
  value: string,
  name: string,
  prefix: 'sk' | 'pk',
): ClerkInstanceKind {
  if (value.startsWith(`${prefix}_live_`)) {
    return 'production';
  }
  if (value.startsWith(`${prefix}_test_`)) {
    return 'development';
  }
  throw new Error(
    `${name} is malformed: expected it to start with ${prefix}_live_ or ${prefix}_test_`,
  );
}

function readList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Resolve and validate the Clerk environment. Throws with an actionable
 * message rather than returning a partially-valid configuration.
 */
export function resolveClerkEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): ClerkEnvironment {
  const secretKey = env.CLERK_SECRET_KEY?.trim();
  const publishableKey = env.CLERK_PUBLISHABLE_KEY?.trim();

  if (!secretKey) {
    throw new Error('CLERK_SECRET_KEY is not configured');
  }
  if (!publishableKey) {
    throw new Error('CLERK_PUBLISHABLE_KEY is not configured');
  }

  const secretInstance = classifyKey(secretKey, 'CLERK_SECRET_KEY', 'sk');
  const publishableInstance = classifyKey(
    publishableKey,
    'CLERK_PUBLISHABLE_KEY',
    'pk',
  );

  // A live secret paired with a test publishable key (or vice versa) means the
  // API is verifying tokens against a different tenant than the one that
  // issued them. Every authenticated request would 401 with no useful signal.
  if (secretInstance !== publishableInstance) {
    throw new Error(
      `Clerk key mismatch: CLERK_SECRET_KEY is a ${secretInstance} key but ` +
        `CLERK_PUBLISHABLE_KEY is a ${publishableInstance} key. Both must come ` +
        `from the same Clerk instance.`,
    );
  }

  const instance = secretInstance;
  const isProduction = env.NODE_ENV === 'production';
  const authorizedParties = readList(env.CLERK_AUTHORIZED_PARTIES);
  const webhookSigningSecret = env.CLERK_WEBHOOK_SIGNING_SECRET?.trim();

  if (isProduction) {
    if (instance !== 'production') {
      throw new Error(
        'Clerk development keys (sk_test_/pk_test_) must not be used when ' +
          'NODE_ENV=production. Deployed environments require a Clerk ' +
          'production instance.',
      );
    }

    // Without authorizedParties, Clerk skips the azp check entirely and will
    // honour a token minted for ANY origin on this instance. cors.ts already
    // refuses to start production without explicit origins; this is the more
    // security-sensitive of the two and was previously unguarded.
    if (authorizedParties.length === 0) {
      throw new Error(
        'CLERK_AUTHORIZED_PARTIES must list explicit trusted origins in ' +
          'production (e.g. https://dashboard.tulink.xyz)',
      );
    }
  }

  // CLERK_WEBHOOK_SIGNING_SECRET is deliberately NOT required, even in
  // production. Session verification (authenticateRequest) does not use it --
  // only verifyWebhook() does. ClerkAuthGuard re-syncs the caller's
  // organizations and memberships from the Clerk API on every authenticated
  // request, so org-scoped access is correct without webhooks; membership
  // revocation self-heals on the revoked user's next request.
  //
  // What webhooks add on top: organization.deleted cleanup (the request-path
  // sync never deletes organizations) and prompt propagation of org renames.
  // Both are housekeeping, so a missing secret degrades rather than breaks --
  // main.ts logs a notice instead of refusing to boot.

  return {
    instance,
    secretKey,
    publishableKey,
    authorizedParties,
    webhookSigningSecret,
  };
}

/**
 * Bootstrap-time assertion. Called from main.ts so misconfiguration stops the
 * process at startup rather than surfacing on the first authenticated request.
 */
export function assertClerkEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): ClerkEnvironment {
  return resolveClerkEnvironment(env);
}
