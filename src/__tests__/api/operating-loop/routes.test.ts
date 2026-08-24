import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const definitions: Array<{ method: string; options: { auth?: boolean; roles?: string[] } }> = [];
const getLoop = jest.fn();
const executeObjective = jest.fn();
const deferObjective = jest.fn();
const dismissObjective = jest.fn();
const getPolicies = jest.fn();
const replacePolicies = jest.fn();

jest.mock('@/lib/error-handling/route-handler', () => ({
  createHttpHandler: (handler: (ctx: unknown) => unknown, method: string, options: { auth?: boolean; roles?: string[] }) => {
    definitions.push({ method, options });
    return handler;
  },
  getVerifiedTenantId: (ctx: { user?: { tenantId?: string } }) => {
    if (!ctx.user?.tenantId) throw new Error('tenant context missing');
    return ctx.user.tenantId;
  },
  getRouteParam: (params: Record<string, string> | undefined, key: string) => {
    if (!params?.[key]) throw new Error(`missing ${key}`);
    return params[key];
  },
}));
jest.mock('@/lib/operating-loop/service', () => ({
  getLoop, executeObjective, deferObjective, dismissObjective, getPolicies, replacePolicies,
}));

import { GET as getOperatingLoop } from '@/app/api/operating-loop/route';
import { POST as execute } from '@/app/api/operating-loop/[objectiveId]/execute/route';
import { POST as defer } from '@/app/api/operating-loop/[objectiveId]/defer/route';
import { POST as dismiss } from '@/app/api/operating-loop/[objectiveId]/dismiss/route';
import { GET as getAutomationPolicies, PUT as putAutomationPolicies } from '@/app/api/operating-loop/policies/route';

function context(body: unknown = undefined) {
  return {
    request: { json: async () => body },
    user: { id: 'owner-1', email: 'owner@booka.test', role: 'owner', tenantId: 'tenant-1' },
    supabase: {},
    params: { objectiveId: 'objective-1' },
  } as never;
}

describe('Daily Operating Loop owner APIs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getLoop.mockResolvedValue({ state: 'clear', primaryObjective: null, supportingSignals: [], automationPaused: false });
    executeObjective.mockResolvedValue({ actionId: 'action-1', outboxId: 'outbox-1', status: 'queued' });
    deferObjective.mockResolvedValue({ action_id: 'action-1', suppression_id: 'suppression-1' });
    dismissObjective.mockResolvedValue({ action_id: 'action-1', suppression_id: 'suppression-1' });
    getPolicies.mockResolvedValue({ automationPaused: false, policies: [] });
    replacePolicies.mockResolvedValue({ automationPaused: true, policies: [] });
  });

  it('returns the compact current loop for the verified tenant', async () => {
    await expect(getOperatingLoop(context())).resolves.toEqual(expect.objectContaining({ state: 'clear' }));
    expect(getLoop).toHaveBeenCalledWith('tenant-1');
  });

  it('executes only the route objective for the verified owner tenant', async () => {
    await expect(execute(context())).resolves.toEqual({ actionId: 'action-1', outboxId: 'outbox-1', status: 'queued' });
    expect(executeObjective).toHaveBeenCalledWith({ tenantId: 'tenant-1', actorId: 'owner-1', objectiveId: 'objective-1' });
  });

  it('rejects a non-future defer timestamp before it reaches the service', async () => {
    await expect(defer(context({ scheduledFor: 'not-a-date' }))).rejects.toBeDefined();
    expect(deferObjective).not.toHaveBeenCalled();
  });

  it('passes an owner dismissal reason only with server-verified tenant identity', async () => {
    await dismiss(context({ reason: 'Already called' }));
    expect(dismissObjective).toHaveBeenCalledWith({
      tenantId: 'tenant-1', actorId: 'owner-1', objectiveId: 'objective-1', reason: 'Already called',
    });
  });

  it('updates policies and the durable pause from a validated owner request', async () => {
    const policies = [{ name: 'Routine confirmations', actionType: 'confirm_booking', status: 'active', eligibilityRules: { maxAmountAtRisk: 50000 }, quietHours: {} }];
    await expect(putAutomationPolicies(context({ automationPaused: true, policies }))).resolves.toEqual({ automationPaused: true, policies: [] });
    expect(replacePolicies).toHaveBeenCalledWith({ tenantId: 'tenant-1', actorId: 'owner-1', automationPaused: true, policies });
    await expect(getAutomationPolicies(context())).resolves.toEqual({ automationPaused: false, policies: [] });
    expect(getPolicies).toHaveBeenCalledWith('tenant-1');
  });

  it('fails closed when a policy request contains an unrecognized executable field', async () => {
    await expect(putAutomationPolicies(context({
      automationPaused: false,
      policies: [{ name: 'Unsafe', actionType: 'confirm_booking', status: 'active', allowAll: true }],
    }))).rejects.toBeDefined();
    expect(replacePolicies).not.toHaveBeenCalled();
  });

  it('registers every route as authenticated and owner-only', () => {
    expect(definitions).toHaveLength(6);
    for (const definition of definitions) {
      expect(definition.options).toEqual(expect.objectContaining({ auth: true, roles: ['owner'] }));
    }
  });
});
