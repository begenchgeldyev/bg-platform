type EvaluateInput = {
  subject: Record<string, unknown>;
  action: string;
  resource: string;
  resourceAttributes: Record<string, unknown>;
  context: Record<string, unknown>;
};

export type Policy = {
  effect: 'allow' | 'deny';
  subjectCondition: unknown;
  action: string;
  resource: string;
  resourceCondition: unknown;
  contextCondition: unknown;
};

function matchesCondition(condition: unknown, actual: Record<string, unknown>) {
  if (!condition || typeof condition !== 'object') return true;
  for (const [key, value] of Object.entries(condition)) {
    if (value === '*') continue;
    if (actual[key] !== value) return false;
  }

  return true;
}

function matchesAction(policyAction: string, requestAction: string) {
  if (policyAction === '*') return true;
  return policyAction.split(',').includes(requestAction);
}

export function evaluate(input: EvaluateInput, policies: Policy[]): 'allow' | 'deny' {
  const matches = policies.filter(
    (policy) =>
      matchesCondition(policy.subjectCondition, input.subject) &&
      matchesAction(policy.action, input.action) &&
      (policy.resource === '*' || policy.resource === input.resource) &&
      matchesCondition(policy.resourceCondition, input.resourceAttributes) &&
      matchesCondition(policy.contextCondition, input.context),
  );

  if (matches.some((p) => p.effect === 'deny')) return 'deny';
  if (matches.some((p) => p.effect === 'allow')) return 'allow';

  return 'deny';
}
