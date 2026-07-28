import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit runs from the HOST, so DATABASE_URL points at localhost
// (see the Postgres block in .env). `import 'dotenv/config'` above loads it.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema/index.ts',
  out: './src/database/migrations',
  dbCredentials: { url: process.env.DATABASE_URL! },
  extensionsFilters: ['postgis'], // ignore PostGIS system tables in diffs
  verbose: true,
  strict: true,
});
