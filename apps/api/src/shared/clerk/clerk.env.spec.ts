import { resolveClerkEnvironment } from './clerk.env';

const DEV_KEYS = {
  CLERK_SECRET_KEY: 'sk_test_abc123',
  CLERK_PUBLISHABLE_KEY: 'pk_test_abc123',
};

const PROD_KEYS = {
  CLERK_SECRET_KEY: 'sk_live_abc123',
  CLERK_PUBLISHABLE_KEY: 'pk_live_abc123',
};

const PROD_ENV = {
  NODE_ENV: 'production',
  ...PROD_KEYS,
  CLERK_AUTHORIZED_PARTIES: 'https://dashboard.tulink.xyz',
  CLERK_WEBHOOK_SIGNING_SECRET: 'whsec_abc123',
} as NodeJS.ProcessEnv;

describe('resolveClerkEnvironment', () => {
  describe('local development', () => {
    it('accepts a development key pair', () => {
      const result = resolveClerkEnvironment({
        NODE_ENV: 'development',
        ...DEV_KEYS,
      });

      expect(result.instance).toBe('development');
    });

    it('allows omitting authorized parties and the webhook secret', () => {
      const result = resolveClerkEnvironment({
        NODE_ENV: 'development',
        ...DEV_KEYS,
      });

      expect(result.authorizedParties).toEqual([]);
      expect(result.webhookSigningSecret).toBeUndefined();
    });

    it('does not object to production keys outside production', () => {
      // Useful for pointing a local process at the production tenant to debug.
      const result = resolveClerkEnvironment({
        NODE_ENV: 'development',
        ...PROD_KEYS,
      });

      expect(result.instance).toBe('production');
    });
  });

  describe('deployed production', () => {
    it('accepts a fully configured production environment', () => {
      const result = resolveClerkEnvironment(PROD_ENV);

      expect(result.instance).toBe('production');
      expect(result.authorizedParties).toEqual([
        'https://dashboard.tulink.xyz',
      ]);
    });

    it('rejects development keys', () => {
      expect(() =>
        resolveClerkEnvironment({ ...PROD_ENV, ...DEV_KEYS }),
      ).toThrow(/must not be used when NODE_ENV=production/);
    });

    it('rejects missing authorized parties', () => {
      expect(() =>
        resolveClerkEnvironment({
          ...PROD_ENV,
          CLERK_AUTHORIZED_PARTIES: undefined,
        }),
      ).toThrow(/CLERK_AUTHORIZED_PARTIES must list explicit trusted origins/);
    });

    it('allows a missing webhook signing secret', () => {
      // Session verification does not use it -- only verifyWebhook() does, and
      // ClerkAuthGuard re-syncs organizations on every authenticated request.
      // main.ts warns instead of failing.
      const result = resolveClerkEnvironment({
        ...PROD_ENV,
        CLERK_WEBHOOK_SIGNING_SECRET: undefined,
      });

      expect(result.instance).toBe('production');
      expect(result.webhookSigningSecret).toBeUndefined();
    });

    it('parses a comma-separated authorized party list', () => {
      const result = resolveClerkEnvironment({
        ...PROD_ENV,
        CLERK_AUTHORIZED_PARTIES:
          'https://dashboard.tulink.xyz, https://tulink.xyz ',
      });

      expect(result.authorizedParties).toEqual([
        'https://dashboard.tulink.xyz',
        'https://tulink.xyz',
      ]);
    });
  });

  describe('instance mismatch', () => {
    // The cutover flips keys in two places (droplet .env and the GitHub secret
    // baked into the dashboard image), so a half-applied change is likely.
    it('rejects a live secret paired with a test publishable key', () => {
      expect(() =>
        resolveClerkEnvironment({
          NODE_ENV: 'development',
          CLERK_SECRET_KEY: 'sk_live_abc123',
          CLERK_PUBLISHABLE_KEY: 'pk_test_abc123',
        }),
      ).toThrow(/Clerk key mismatch/);
    });

    it('rejects a test secret paired with a live publishable key', () => {
      expect(() =>
        resolveClerkEnvironment({
          NODE_ENV: 'development',
          CLERK_SECRET_KEY: 'sk_test_abc123',
          CLERK_PUBLISHABLE_KEY: 'pk_live_abc123',
        }),
      ).toThrow(/Clerk key mismatch/);
    });
  });

  describe('malformed configuration', () => {
    it('rejects a missing secret key', () => {
      expect(() =>
        resolveClerkEnvironment({
          NODE_ENV: 'development',
          CLERK_PUBLISHABLE_KEY: 'pk_test_abc123',
        }),
      ).toThrow(/CLERK_SECRET_KEY is not configured/);
    });

    it('rejects a missing publishable key', () => {
      // Previously optional: createClerkClient() accepted undefined, so this
      // only surfaced later as a handshake failure.
      expect(() =>
        resolveClerkEnvironment({
          NODE_ENV: 'development',
          CLERK_SECRET_KEY: 'sk_test_abc123',
        }),
      ).toThrow(/CLERK_PUBLISHABLE_KEY is not configured/);
    });

    it('rejects a key with an unrecognized prefix', () => {
      expect(() =>
        resolveClerkEnvironment({
          NODE_ENV: 'development',
          CLERK_SECRET_KEY: 'not_a_clerk_key',
          CLERK_PUBLISHABLE_KEY: 'pk_test_abc123',
        }),
      ).toThrow(/CLERK_SECRET_KEY is malformed/);
    });
  });
});
