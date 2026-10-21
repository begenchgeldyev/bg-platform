import { sessionEmail } from '../auth/session';
import { evaluate } from './pdp';
import { getPolicies, getSubjectAttributes } from './pip';

type ABACContext = {
  actions: string;
  resource: string;
  resourceAttributes?: Record<string, unknown>;
};

export function resolveEmail(req: Request): string | null {
  return sessionEmail(req);
}

export async function canAccess(req: Request, abacContext: ABACContext): Promise<boolean> {
  const email = resolveEmail(req);
  const subject = await getSubjectAttributes(email);
  const policies = await getPolicies();

  const context = {
    ip: req.headers.get('x-forwarded-for') || 'unknown',
    method: req.method,
  };

  const decision = evaluate(
    {
      subject,
      action: abacContext.actions,
      resource: abacContext.resource,
      resourceAttributes: abacContext.resourceAttributes || {},
      context,
    },
    policies,
  );

  return decision !== 'deny';
}

export function enforce(handler: (req: Request) => Promise<Response>, abacContext: ABACContext) {
  return async (req: Request): Promise<Response> => {
    const email = resolveEmail(req);
    const subject = await getSubjectAttributes(email);
    const policies = await getPolicies();

    const context = {
      ip: req.headers.get('x-forwarded-for') || 'unknown',
      method: req.method,
    };

    const decision = evaluate(
      {
        subject,
        action: abacContext.actions,
        resource: abacContext.resource,
        resourceAttributes: abacContext.resourceAttributes || {},
        context,
      },
      policies,
    );

    if (decision === 'deny') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    return handler(req);
  };
}
