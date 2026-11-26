import { drizzle } from 'drizzle-orm/bun-sql';

// biome-ignore lint/style/noNonNullAssertion: tests and pages import this module without a database; a missing URL must not break them at import time
export const db = drizzle(process.env.DATABASE_URL!);
export type Db = typeof db;
