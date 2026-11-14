import { eq } from 'drizzle-orm';
import { type Db, db } from '../db';
import { policies, users } from '../db/schema';
import type { Policy } from './pdp';

// The only test seam is policy data; identity verification and PDP evaluation remain real.
export interface PolicySource {
  getSubjectAttributes(email: string | null): Promise<Record<string, unknown>>;
  getPolicies(): Promise<Policy[]>;
}

export function createPolicySource(database: Db): PolicySource {
  return {
    async getSubjectAttributes(email) {
      if (!email) return { role: 'viewer' };

      const [user] = await database.select().from(users).where(eq(users.email, email));
      if (!user) return { role: 'viewer' };

      return { role: user.role, ...(user.attributes as Record<string, unknown>) };
    },
    async getPolicies() {
      return database.select().from(policies);
    },
  };
}

export const { getSubjectAttributes, getPolicies } = createPolicySource(db);
