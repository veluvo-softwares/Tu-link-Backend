import { registerAs } from '@nestjs/config';

export default registerAs('auth', () => ({
  revocationCacheTtlSeconds: parseInt(
    process.env.AUTH_REVOCATION_CACHE_TTL_S || '60',
    10,
  ),
}));
