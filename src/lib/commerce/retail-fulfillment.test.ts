import {
  RetailFulfillmentSettingsSchema,
  mergeRetailFulfillmentContext,
  resolveRetailFulfillment,
  toSafeFulfillmentSummary,
  type RetailOrderFulfillmentContext,
} from './retail-fulfillment';

const emptyContext: RetailOrderFulfillmentContext = {
  method: null,
  provider: null,
  deliveryAddress: null,
  serviceArea: null,
  feeStatus: 'not_required',
  deliveryFeeCents: null,
  arrangementStatus: 'not_started',
  conversationThreadId: null,
};

describe('retail fulfillment decisions', () => {
  it('allows configured customer pickup without a delivery fee', () => {
    expect(resolveRetailFulfillment({
      settings: {
        methods: ['customer_pickup'],
        thirdPartyProviders: [],
        serviceAreas: [],
        feePolicy: 'included',
      },
      context: { ...emptyContext, method: 'customer_pickup' },
    })).toEqual({
      status: 'ready',
      reasonCode: null,
      deliveryFeeCents: 0,
    });
  });

  it('requires an address before own dispatch can proceed', () => {
    expect(resolveRetailFulfillment({
      settings: {
        methods: ['own_dispatch'],
        thirdPartyProviders: [],
        serviceAreas: ['Lekki'],
        feePolicy: 'fixed',
        fixedFeeCents: 250000,
      },
      context: { ...emptyContext, method: 'own_dispatch' },
    })).toEqual({
      status: 'awaiting_customer',
      reasonCode: 'delivery_address_required',
      deliveryFeeCents: null,
    });
  });

  it('returns the configured fixed fee without accumulating it on replay', () => {
    const settings = {
      methods: ['own_dispatch'] as const,
      thirdPartyProviders: [] as const,
      serviceAreas: ['Lekki'] as const,
      feePolicy: 'fixed' as const,
      fixedFeeCents: 250000,
    };
    const context = {
      ...emptyContext,
      method: 'own_dispatch' as const,
      deliveryAddress: '12 Admiralty Way',
    };

    const first = resolveRetailFulfillment({ settings, context });
    const replay = resolveRetailFulfillment({
      settings,
      context: mergeRetailFulfillmentContext(context, {
        feeStatus: 'known',
        deliveryFeeCents: first.deliveryFeeCents,
      }),
    });

    expect(first).toEqual({ status: 'ready', reasonCode: null, deliveryFeeCents: 250000 });
    expect(replay).toEqual(first);
  });

  it.each(['quote_required', 'manual'] as const)(
    'hands own dispatch with %s pricing to a human',
    (feePolicy) => {
      expect(resolveRetailFulfillment({
        settings: {
          methods: ['own_dispatch'],
          thirdPartyProviders: [],
          serviceAreas: [],
          feePolicy,
        },
        context: {
          ...emptyContext,
          method: 'own_dispatch',
          deliveryAddress: '12 Admiralty Way',
        },
      })).toEqual({
        status: 'awaiting_human',
        reasonCode: 'delivery_fee_requires_human',
        deliveryFeeCents: null,
      });
    },
  );

  it('always hands third-party manual delivery to a human', () => {
    expect(resolveRetailFulfillment({
      settings: {
        methods: ['third_party_manual'],
        thirdPartyProviders: ['bolt'],
        serviceAreas: [],
        feePolicy: 'quote_required',
      },
      context: {
        ...emptyContext,
        method: 'third_party_manual',
        provider: 'bolt',
        deliveryAddress: '12 Admiralty Way',
      },
    })).toEqual({
      status: 'awaiting_human',
      reasonCode: 'third_party_arrangement_required',
      deliveryFeeCents: null,
    });
  });

  it('requires a human when fulfillment is not configured', () => {
    expect(resolveRetailFulfillment({ settings: null, context: emptyContext })).toEqual({
      status: 'awaiting_human',
      reasonCode: 'fulfillment_not_configured',
      deliveryFeeCents: null,
    });
  });

  it('uses a confirmed human arrangement even if the tenant policy changes', () => {
    expect(resolveRetailFulfillment({
      settings: null,
      context: {
        ...emptyContext,
        method: 'third_party_manual',
        provider: 'indrive',
        deliveryAddress: '12 Admiralty Way',
        feeStatus: 'confirmed',
        deliveryFeeCents: 300000,
        arrangementStatus: 'arranged',
      },
    })).toEqual({ status: 'ready', reasonCode: null, deliveryFeeCents: 300000 });
  });

  it('asks the customer to choose when more than one method is configured', () => {
    expect(resolveRetailFulfillment({
      settings: {
        methods: ['customer_pickup', 'own_dispatch'],
        thirdPartyProviders: [],
        serviceAreas: [],
        feePolicy: 'included',
      },
      context: emptyContext,
    })).toEqual({
      status: 'awaiting_customer',
      reasonCode: 'fulfillment_method_required',
      deliveryFeeCents: null,
    });
  });

  it('rejects inconsistent tenant configuration', () => {
    expect(RetailFulfillmentSettingsSchema.safeParse({
      methods: ['customer_pickup'],
      thirdPartyProviders: ['bolt'],
      serviceAreas: [],
      feePolicy: 'fixed',
    }).success).toBe(false);
  });

  it('omits address and thread identifiers from safe summaries', () => {
    const summary = toSafeFulfillmentSummary({
      ...emptyContext,
      method: 'own_dispatch',
      deliveryAddress: 'private address',
      conversationThreadId: 'thread-secret',
      feeStatus: 'known',
      deliveryFeeCents: 250000,
    });

    expect(summary).toEqual({
      method: 'own_dispatch',
      provider: null,
      feeStatus: 'known',
      arrangementStatus: 'not_started',
    });
    expect(JSON.stringify(summary)).not.toContain('private address');
    expect(JSON.stringify(summary)).not.toContain('thread-secret');
  });
});
