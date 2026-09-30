import { z } from 'zod';

export const RetailFulfillmentMethodSchema = z.enum([
  'customer_pickup',
  'own_dispatch',
  'third_party_manual',
]);

export const RetailFulfillmentProviderSchema = z.enum(['bolt', 'indrive', 'other']);

export const RetailDeliveryFeePolicySchema = z.enum([
  'included',
  'fixed',
  'quote_required',
  'manual',
]);

export const RetailFulfillmentSettingsSchema = z.object({
  methods: z.array(RetailFulfillmentMethodSchema).max(3),
  thirdPartyProviders: z.array(RetailFulfillmentProviderSchema).max(3),
  serviceAreas: z.array(z.string().trim().min(1).max(80)).max(25),
  feePolicy: RetailDeliveryFeePolicySchema,
  fixedFeeCents: z.number().int().min(0).max(100_000_000).optional(),
  customerNotice: z.string().trim().max(500).optional(),
}).strict().superRefine((settings, ctx) => {
  if (new Set(settings.methods).size !== settings.methods.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['methods'],
      message: 'Fulfillment methods must be unique',
    });
  }
  if (new Set(settings.thirdPartyProviders).size !== settings.thirdPartyProviders.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['thirdPartyProviders'],
      message: 'Third-party providers must be unique',
    });
  }
  const usesThirdParty = settings.methods.includes('third_party_manual');
  if (usesThirdParty && settings.thirdPartyProviders.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['thirdPartyProviders'],
      message: 'Choose at least one manually arranged delivery provider',
    });
  }
  if (!usesThirdParty && settings.thirdPartyProviders.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['thirdPartyProviders'],
      message: 'Third-party providers require the third-party delivery method',
    });
  }
  if (settings.feePolicy === 'fixed' && settings.fixedFeeCents === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['fixedFeeCents'],
      message: 'A fixed delivery fee is required',
    });
  }
  if (settings.feePolicy !== 'fixed' && settings.fixedFeeCents !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['fixedFeeCents'],
      message: 'A fixed delivery fee is only allowed with the fixed fee policy',
    });
  }
});

export type RetailFulfillmentMethod = z.infer<typeof RetailFulfillmentMethodSchema>;
export type RetailFulfillmentProvider = z.infer<typeof RetailFulfillmentProviderSchema>;
export type RetailDeliveryFeePolicy = z.infer<typeof RetailDeliveryFeePolicySchema>;
export type RetailFulfillmentSettings = z.infer<typeof RetailFulfillmentSettingsSchema>;

export const RetailOrderFulfillmentContextSchema = z.object({
  method: RetailFulfillmentMethodSchema.nullable(),
  provider: RetailFulfillmentProviderSchema.nullable(),
  deliveryAddress: z.string().trim().min(1).max(500).nullable(),
  serviceArea: z.string().trim().min(1).max(80).nullable(),
  feeStatus: z.enum(['not_required', 'known', 'quote_required', 'confirmed']),
  deliveryFeeCents: z.number().int().min(0).max(100_000_000).nullable(),
  arrangementStatus: z.enum([
    'not_started',
    'awaiting_customer_choice',
    'awaiting_human',
    'arranged',
    'completed',
  ]),
  arrangementNote: z.string().trim().max(500).nullable().optional(),
  conversationThreadId: z.string().uuid().nullable(),
}).strict();

export type RetailOrderFulfillmentContext = z.infer<typeof RetailOrderFulfillmentContextSchema>;

export function emptyRetailOrderFulfillmentContext(): RetailOrderFulfillmentContext {
  return {
    method: null,
    provider: null,
    deliveryAddress: null,
    serviceArea: null,
    feeStatus: 'not_required',
    deliveryFeeCents: null,
    arrangementStatus: 'not_started',
    arrangementNote: null,
    conversationThreadId: null,
  };
}

export type RetailFulfillmentDecision =
  | {
      status: 'ready';
      reasonCode: null;
      deliveryFeeCents: number;
    }
  | {
      status: 'awaiting_customer';
      reasonCode: 'fulfillment_method_required' | 'delivery_address_required';
      deliveryFeeCents: null;
    }
  | {
      status: 'awaiting_human';
      reasonCode:
        | 'fulfillment_not_configured'
        | 'delivery_fee_requires_human'
        | 'third_party_arrangement_required';
      deliveryFeeCents: null;
    };

type SettingsInput = {
  methods: readonly RetailFulfillmentMethod[];
  thirdPartyProviders: readonly RetailFulfillmentProvider[];
  serviceAreas: readonly string[];
  feePolicy: RetailDeliveryFeePolicy;
  fixedFeeCents?: number;
  customerNotice?: string;
};

export function resolveRetailFulfillment(input: {
  settings: SettingsInput | null | undefined;
  context: RetailOrderFulfillmentContext;
}): RetailFulfillmentDecision {
  const { context } = input;
  if (
    context.method
    && context.arrangementStatus === 'arranged'
    && context.feeStatus === 'confirmed'
    && Number.isInteger(context.deliveryFeeCents)
    && Number(context.deliveryFeeCents) >= 0
  ) {
    return {
      status: 'ready',
      reasonCode: null,
      deliveryFeeCents: Number(context.deliveryFeeCents),
    };
  }

  const settingsResult = RetailFulfillmentSettingsSchema.safeParse(input.settings);
  if (!settingsResult.success || settingsResult.data.methods.length === 0) {
    return {
      status: 'awaiting_human',
      reasonCode: 'fulfillment_not_configured',
      deliveryFeeCents: null,
    };
  }

  const settings = settingsResult.data;
  const method = context.method
    ?? (settings.methods.length === 1 ? settings.methods[0] : null);
  if (!method || !settings.methods.includes(method)) {
    return {
      status: 'awaiting_customer',
      reasonCode: 'fulfillment_method_required',
      deliveryFeeCents: null,
    };
  }

  if (method === 'customer_pickup') {
    return { status: 'ready', reasonCode: null, deliveryFeeCents: 0 };
  }

  if (!context.deliveryAddress?.trim()) {
    return {
      status: 'awaiting_customer',
      reasonCode: 'delivery_address_required',
      deliveryFeeCents: null,
    };
  }

  if (method === 'third_party_manual') {
    return {
      status: 'awaiting_human',
      reasonCode: 'third_party_arrangement_required',
      deliveryFeeCents: null,
    };
  }

  if (settings.feePolicy === 'included') {
    return { status: 'ready', reasonCode: null, deliveryFeeCents: 0 };
  }
  if (settings.feePolicy === 'fixed') {
    return {
      status: 'ready',
      reasonCode: null,
      deliveryFeeCents: settings.fixedFeeCents ?? 0,
    };
  }
  return {
    status: 'awaiting_human',
    reasonCode: 'delivery_fee_requires_human',
    deliveryFeeCents: null,
  };
}

export function mergeRetailFulfillmentContext(
  current: RetailOrderFulfillmentContext,
  patch: Partial<RetailOrderFulfillmentContext>,
): RetailOrderFulfillmentContext {
  return { ...current, ...patch };
}

export function toSafeFulfillmentSummary(context: RetailOrderFulfillmentContext) {
  return {
    method: context.method,
    provider: context.provider,
    feeStatus: context.feeStatus,
    arrangementStatus: context.arrangementStatus,
  };
}

export type RetailFulfillmentSafeSummary = ReturnType<typeof toSafeFulfillmentSummary>;
