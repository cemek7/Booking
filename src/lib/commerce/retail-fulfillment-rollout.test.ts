import { resolveRetailFulfillmentRollout } from './retail-fulfillment-rollout';

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
});
