import { describe, expect, test } from 'bun:test';
import { createAuthorization, createSessionToken, OWNER_EMAIL, type PolicySource, SESSION_MAX_AGE_SECONDS, sessionEmail } from '../index';

type Policy = Awaited<ReturnType<PolicySource['getPolicies']>>[number];
const secret = 'project-access-test-secret';
const allow: Policy = {
  effect: 'allow',
  subjectCondition: { role: 'owner' },
  action: 'update',
  resource: 'project',
  resourceCondition: {},
  contextCondition: {},
};

function request(token?: string) {
  return new Request('http://localhost/api/projects', {
    method: 'PATCH',
    headers: token ? { cookie: `bg_session=${token}` } : {},
  });
}

function fixture(initialPolicies: Policy[] = [allow]) {
  const reads: (string | null)[] = [];
  const identities: Request[] = [];
  let currentSecret = secret;
  let policies = initialPolicies;
  let failure: 'subject' | 'policies' | undefined;
  const policySource: PolicySource = {
    async getSubjectAttributes(email) {
      reads.push(email);
      if (failure === 'subject') throw new Error('storage unavailable');
      return { role: email ? 'owner' : 'viewer' };
    },
    async getPolicies() {
      reads.push('policies');
      if (failure === 'policies') throw new Error('storage unavailable');
      return policies;
    },
  };
  const authorization = createAuthorization({
    policySource,
    resolveIdentity(req) {
      identities.push(req);
      return sessionEmail(req, currentSecret);
    },
  });
  return {
    ...authorization,
    reads,
    identities,
    rotateSecret() {
      currentSecret = 'rotated-secret';
    },
    setPolicies(value: Policy[]) {
      policies = value;
    },
    failAt(value: typeof failure) {
      failure = value;
    },
  };
}

describe('projectAccess with signed identity and real PDP', () => {
  test('absent, spoofed, invalid and expired sessions are visitors without storage reads', async () => {
    const access = fixture();
    const requests = [
      request(),
      request('invalid'),
      request(createSessionToken(secret, Date.now() - (SESSION_MAX_AGE_SECONDS + 1) * 1000)),
      new Request('http://localhost/admin', { headers: { 'x-user-email': OWNER_EMAIL, cookie: `dev-user-email=${OWNER_EMAIL}` } }),
    ];
    for (const req of requests) expect(await access.projectAccess(req)).toBe('visitor');
    expect(access.reads).toEqual([]);
    expect(access.identities).toEqual(requests);
  });

  test('rotation invalidates an existing session, without a cross-request decision cache', async () => {
    const access = fixture();
    const req = request(createSessionToken(secret));
    expect(await access.projectAccess(req)).toBe('editor');
    access.rotateSecret();
    expect(await access.projectAccess(req)).toBe('visitor');
    expect(access.reads).toEqual([OWNER_EMAIL, 'policies']);
    expect(access.identities).toEqual([req, req]);
  });

  test('a valid denied session is read-only; allow edits; matching deny overrides allow', async () => {
    const access = fixture([]);
    const req = request(createSessionToken(secret));
    expect(await access.projectAccess(req)).toBe('read-only');
    access.setPolicies([allow]);
    expect(await access.projectAccess(req)).toBe('editor');
    access.setPolicies([allow, { ...allow, effect: 'deny' }]);
    expect(await access.projectAccess(req)).toBe('read-only');
    expect(access.identities).toHaveLength(3);
    expect(access.reads).toEqual([OWNER_EMAIL, 'policies', OWNER_EMAIL, 'policies', OWNER_EMAIL, 'policies']);
  });

  test('project action/resource and request context are evaluated by the PDP', async () => {
    const access = fixture([
      { ...allow, action: 'read' },
      { ...allow, resource: 'other' },
    ]);
    const req = request(createSessionToken(secret));
    expect(await access.projectAccess(req)).toBe('read-only');
    access.setPolicies([{ ...allow, contextCondition: { method: 'PATCH', ip: 'unknown' } }]);
    expect(await access.projectAccess(req)).toBe('editor');
  });

  test('subject or policy storage failure propagates instead of granting edit rights', async () => {
    for (const stage of ['subject', 'policies'] as const) {
      const access = fixture();
      access.failAt(stage);
      await expect(access.projectAccess(request(createSessionToken(secret)))).rejects.toThrow('storage unavailable');
    }
  });
});

describe('generic ABAC preserves anonymous viewer semantics', () => {
  const viewerAllow = { ...allow, subjectCondition: { role: 'viewer' } };

  test('canAccess evaluates anonymous viewers instead of applying the project fast path', async () => {
    const access = fixture([viewerAllow]);
    expect(await access.canAccess(request(), { actions: 'update', resource: 'project' })).toBe(true);
    expect(access.reads).toEqual([null, 'policies']);
    access.setPolicies([]);
    expect(await access.canAccess(request(), { actions: 'update', resource: 'project' })).toBe(false);
  });

  test('enforce shares viewer evaluation, calls the handler only on allow and returns its response', async () => {
    const access = fixture([viewerAllow]);
    const handled: Request[] = [];
    const response = new Response('allowed', { status: 202 });
    const enforce = access.enforce(
      async (req) => {
        handled.push(req);
        return response;
      },
      { actions: 'update', resource: 'project' },
    );
    const req = request();
    expect(await enforce(req)).toBe(response);
    access.setPolicies([viewerAllow, { ...viewerAllow, effect: 'deny' }]);
    const denied = await enforce(req);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: 'Forbidden' });
    access.setPolicies([]);
    expect((await enforce(req)).status).toBe(403);
    expect(handled).toEqual([req]);
    expect(access.identities).toEqual([req, req, req]);
  });
});
