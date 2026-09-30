"use client";

import { useEffect, useState } from 'react';
import RetailFulfillmentFields, {
  EMPTY_RETAIL_FULFILLMENT_FORM,
  toRetailFulfillmentSettings,
  type RetailFulfillmentFormValue,
} from '@/components/onboarding/RetailFulfillmentFields';
import type { RetailFulfillmentSettings } from '@/lib/commerce/retail-fulfillment';

function toFormValue(value?: RetailFulfillmentSettings): RetailFulfillmentFormValue {
  if (!value) return EMPTY_RETAIL_FULFILLMENT_FORM;
  return {
    methods: [...value.methods],
    thirdPartyProviders: [...value.thirdPartyProviders],
    serviceAreas: value.serviceAreas.join(', '),
    feePolicy: value.feePolicy,
    fixedFeeNaira: value.fixedFeeCents === undefined
      ? ''
      : String(value.fixedFeeCents / 100),
    customerNotice: value.customerNotice ?? '',
  };
}

export function OrderFulfillmentSection({
  value,
  onChange,
}: {
  value?: RetailFulfillmentSettings;
  onChange: (value: RetailFulfillmentSettings) => void;
}) {
  const [form, setForm] = useState<RetailFulfillmentFormValue>(() => toFormValue(value));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm(toFormValue(value));
  }, [value]);

  function update(next: RetailFulfillmentFormValue) {
    setForm(next);
    const parsed = toRetailFulfillmentSettings(next);
    if (!parsed.success) {
      setError(parsed.error);
      return;
    }
    setError(null);
    onChange(parsed.data);
  }

  const configured = Boolean(value?.methods.length);
  return (
    <section className="space-y-3" aria-labelledby="order-fulfillment-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id="order-fulfillment-heading" className="text-sm font-semibold text-gray-950">
            Product delivery policy
          </h3>
          <p className="mt-1 text-xs leading-5 text-gray-600">
            Used before Booka requests payment for a physical product order.
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${
          configured ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'
        }`}>
          {configured ? 'Configured' : 'Not configured'}
        </span>
      </div>
      <RetailFulfillmentFields value={form} onChange={update} error={error} />
    </section>
  );
}
