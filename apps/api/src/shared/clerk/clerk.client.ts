import { createClerkClient } from '@clerk/backend';
import { InternalServerErrorException } from '@nestjs/common';

let clerkClient: ReturnType<typeof createClerkClient> | null = null;

export function getClerkClient() {
  const secretKey = process.env.CLERK_SECRET_KEY;

  if (!secretKey) {
    throw new InternalServerErrorException(
      'CLERK_SECRET_KEY is not configured',
    );
  }

  if (!clerkClient) {
    clerkClient = createClerkClient({
      secretKey,
      publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
    });
  }

  return clerkClient;
}
