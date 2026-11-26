import { defineConfig } from 'drizzle-kit';

// biome-ignore lint/style/noNonNullAssertion: drizzle-kit only reads this when a database command runs; a missing URL should fail there, not on import
const url = process.env.DATABASE_URL!;

export default defineConfig({
  dialect: 'postgresql',
  schema: './db/schema.ts',
  out: './drizzle/migrations',
  dbCredentials: {
    url,
  },
});
