import { sessionEmail } from '../auth/session';
import { evaluate } from './pdp';
import { getPolicies, getSubjectAttributes, type PolicySource } from './pip';

type ABACContext = {
  actions: string;
  resource: string;
  resourceAttributes?: Record<string, unknown>;
};

export type ProjectAccess = 'visitor' | 'read-only' | 'editor';
export type ProjectAccessResolver = (req: Request) => Promise<ProjectAccess>;

export function resolveEmail(req: Request): string | null {
  return sessionEmail(req);
}

export function createAuthorization({
  policySource,
  resolveIdentity = resolveEmail,
}: {
  policySource: PolicySource;
  resolveIdentity?: (req: Request) => string | null;
}) {
  // Identity is passed in, never resolved again during policy evaluation.
  async function evaluateAccess(req: Request, email: string | null, abacContext: ABACContext): Promise<boolean> {
    const subject = await policySource.getSubjectAttributes(email);
    const policies = await policySource.getPolicies();
    return (
      evaluate(
        {
          subject,
          action: abacContext.actions,
          resource: abacContext.resource,
          resourceAttributes: abacContext.resourceAttributes || {},
          context: {
            ip: req.headers.get('x-forwarded-for') || 'unknown',
            method: req.method,
          },
        },
        policies,
      ) === 'allow'
    );
  }

  async function canAccess(req: Request, abacContext: ABACContext): Promise<boolean> {
    // Generic ABAC deliberately still evaluates anonymous subjects as viewers.
    return evaluateAccess(req, resolveIdentity(req), abacContext);
  }

  const projectAccess: ProjectAccessResolver = async (req) => {
    const email = resolveIdentity(req);
    if (!email) return 'visitor';
    return (await evaluateAccess(req, email, { actions: 'update', resource: 'project' })) ? 'editor' : 'read-only';
  };

  function enforce(handler: (req: Request) => Promise<Response>, abacContext: ABACContext) {
    return async (req: Request): Promise<Response> => {
      if (!(await canAccess(req, abacContext))) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
      return handler(req);
    };
  }

  return { canAccess, enforce, projectAccess };
}

export const { canAccess, enforce, projectAccess } = createAuthorization({
  policySource: { getSubjectAttributes, getPolicies },
});
