import { registerAs } from '@nestjs/config';

export default registerAs('database', () => ({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  user: process.env.POSTGRES_USER || 'tulink',
  password: process.env.POSTGRES_PASSWORD || undefined,
  database: process.env.POSTGRES_DB || 'tulink',
  poolMax: parseInt(process.env.POSTGRES_POOL_MAX || '10', 10),
}));
