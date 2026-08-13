import { createClerkClient } from '@clerk/backend';
import { InternalServerErrorException } from '@nestjs/common';
import { resolveClerkEnvironment, type ClerkEnvironment } from './clerk.env';

let clerkClient: ReturnType<typeof createClerkClient> | null = null;
let clerkEnvironment: ClerkEnvironment | null = null;

/**
 * Resolve the validated Clerk environment, translating configuration errors
 * into a 500 rather than letting a raw Error escape into the request pipeline.
 * main.ts asserts the same configuration at boot, so in a correctly deployed
 * process this never throws.
 *
 * Memoized because the auth guard needs it on every authenticated request and
 * the environment cannot change within a process lifetime.
 */
function clerkEnvironmentOrThrow(): ClerkEnvironment {
  if (clerkEnvironment) {
    return clerkEnvironment;
  }

  try {
    clerkEnvironment = resolveClerkEnvironment();
  } catch (error) {
    throw new InternalServerErrorException(
      error instanceof Error ? error.message : 'Clerk is not configured',
    );
  }

  return clerkEnvironment;
}

export function getClerkClient() {
  if (!clerkClient) {
    const { secretKey, publishableKey } = clerkEnvironmentOrThrow();

    clerkClient = createClerkClient({ secretKey, publishableKey });
  }

  return clerkClient;
}

/**
 * Origins permitted to present session tokens to this API.
 *
 * Returns undefined when no origins are configured, which is how the Clerk SDK
 * expects "skip the authorized-party check" to be expressed. That case is only
 * reachable outside production -- resolveClerkEnvironment() refuses to start a
 * production process without an explicit list.
 */
export function getClerkAuthorizedParties(): string[] | undefined {
  const { authorizedParties } = clerkEnvironmentOrThrow();

  return authorizedParties.length > 0 ? authorizedParties : undefined;
}

/** Reset memoized state. Tests only. */
export function resetClerkClientForTesting() {
  clerkClient = null;
  clerkEnvironment = null;
}
