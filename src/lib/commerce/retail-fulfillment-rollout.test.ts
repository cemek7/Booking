import {
  buildRetailFulfillmentMetricLabels,
  resolveRetailFulfillmentRollout,
} from './retail-fulfillment-rollout';

describe('retail fulfillment rollout', () => {
  it.each([undefined, '', 'invalid'])('defaults %p to off', (globalMode) => {
    expect(resolveRetailFulfillmentRollout({
      globalMode,
      tenantSettings: { rollouts: { retailFulfillment: 'live' } },
    })).toBe('off');
  });

  it('keeps a tenant off when the global gate is off', () => {
    expect(resolveRetailFulfillmentRollout({
      globalMode: 'off',
      tenantSettings: { rollouts: { retailFulfillment: 'live' } },
    })).toBe('off');
  });

  it.each(['shadow', 'live'] as const)(
    'permits a tenant pilot while global mode is %s',
    (globalMode) => {
      expect(resolveRetailFulfillmentRollout({
        globalMode,
        tenantSettings: { rollouts: { retailFulfillment: 'live' } },
      })).toBe('live');
    },
  );

  it.each(['shadow', 'live'] as const)(
    'keeps unselected tenants in shadow while global mode is %s',
    (globalMode) => {
      expect(resolveRetailFulfillmentRollout({
        globalMode,
        tenantSettings: {},
      })).toBe('shadow');
    },
  );

  it('emits only fixed allowlisted labels for shadow decisions', () => {
    const labels = buildRetailFulfillmentMetricLabels({
      mode: 'shadow',
      surface: 'payment_link',
      status: 'awaiting_human',
      reasonCode: 'third_party_arrangement_required',
      provider: 'bolt',
      deliveryAddress: 'Private address',
      phone: '+2348000000000',
      arrangementNote: 'Call the rider',
      amountMinor: 185000,
      authorizationCode: 'AUTH_secret',
    } as never);

    expect(labels).toEqual({
      mode: 'shadow',
      surface: 'payment_link',
      status: 'awaiting_human',
      reason: 'third_party_arrangement_required',
      provider: 'bolt',
    });
    const serialized = JSON.stringify(labels);
    expect(serialized).not.toMatch(/Private address|2348000000000|Call the rider|185000|AUTH_secret/);
  });
});
