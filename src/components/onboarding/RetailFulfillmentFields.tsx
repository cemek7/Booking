"use client";

import { useId } from 'react';
import {
  RetailFulfillmentSettingsSchema,
  type RetailDeliveryFeePolicy,
  type RetailFulfillmentMethod,
  type RetailFulfillmentProvider,
  type RetailFulfillmentSettings,
} from '@/lib/commerce/retail-fulfillment';

export interface RetailFulfillmentFormValue {
  methods: RetailFulfillmentMethod[];
  thirdPartyProviders: RetailFulfillmentProvider[];
  serviceAreas: string;
  feePolicy: RetailDeliveryFeePolicy;
  fixedFeeNaira: string;
  customerNotice: string;
}

export const EMPTY_RETAIL_FULFILLMENT_FORM: RetailFulfillmentFormValue = {
  methods: [],
  thirdPartyProviders: [],
  serviceAreas: '',
  feePolicy: 'included',
  fixedFeeNaira: '',
  customerNotice: '',
};

export function toRetailFulfillmentSettings(value: RetailFulfillmentFormValue):
  | { success: true; data: RetailFulfillmentSettings }
  | { success: false; error: string } {
  let fixedFeeCents: number | undefined;
  if (value.feePolicy === 'fixed') {
    const amount = Number(value.fixedFeeNaira);
    if (!value.fixedFeeNaira.trim() || !Number.isFinite(amount) || amount < 0) {
      return { success: false, error: 'Enter a valid delivery fee of zero or more' };
    }
    fixedFeeCents = Math.round(amount * 100);
  }

  const candidate = {
    methods: [...new Set(value.methods)],
    thirdPartyProviders: value.methods.includes('third_party_manual')
      ? [...new Set(value.thirdPartyProviders)]
      : [],
    serviceAreas: [...new Set(
      value.serviceAreas.split(',').map((area) => area.trim()).filter(Boolean),
    )],
    feePolicy: value.feePolicy,
    ...(fixedFeeCents === undefined ? {} : { fixedFeeCents }),
    ...(value.customerNotice.trim() ? { customerNotice: value.customerNotice.trim() } : {}),
  };
  const parsed = RetailFulfillmentSettingsSchema.safeParse(candidate);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Check fulfilment details' };
  }
  return { success: true, data: parsed.data };
}

type Props = {
  value: RetailFulfillmentFormValue;
  onChange: (value: RetailFulfillmentFormValue) => void;
  error?: string | null;
  disabled?: boolean;
};

const methods: Array<{ value: RetailFulfillmentMethod; label: string; detail: string }> = [
  {
    value: 'customer_pickup',
    label: 'Customers pick up from us',
    detail: 'Booka confirms the order for collection.',
  },
  {
    value: 'own_dispatch',
    label: 'Our rider or dispatch team delivers',
    detail: 'Use a known included or fixed fee, or ask your team to quote.',
  },
  {
    value: 'third_party_manual',
    label: 'We arrange Bolt, inDrive or another local courier',
    detail: 'Booka pauses for your team to confirm availability and cost.',
  },
];

const providers: Array<{ value: RetailFulfillmentProvider; label: string }> = [
  { value: 'bolt', label: 'Bolt' },
  { value: 'indrive', label: 'inDrive' },
  { value: 'other', label: 'Another local courier' },
];

function toggleValue<T extends string>(items: T[], item: T): T[] {
  return items.includes(item) ? items.filter((entry) => entry !== item) : [...items, item];
}

export default function RetailFulfillmentFields({ value, onChange, error, disabled = false }: Props) {
  const id = useId();
  const inputClass = 'w-full rounded-2xl border border-[var(--brand-line)] bg-white px-4 py-3 text-base text-[var(--brand-ink)] outline-none transition placeholder:text-slate-400 focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 sm:text-sm';
  const labelClass = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.2em] text-[#597061]';

  return (
    <fieldset
      className="space-y-4 rounded-[1.6rem] border border-emerald-100 bg-emerald-50/40 p-4 sm:p-5"
      disabled={disabled}
      aria-describedby={error ? `${id}-error` : `${id}-description`}
    >
      <legend className="px-1 text-sm font-semibold text-[var(--brand-ink)]">Order fulfilment</legend>
      <p id={`${id}-description`} className="text-sm leading-6 text-slate-600">
        Choose how product orders reach customers. Booka will pause for your team whenever a delivery fee or courier must be confirmed.
      </p>

      <div className="space-y-2">
        <p className={labelClass}>How can customers receive product orders?</p>
        {methods.map((method) => (
          <label
            key={method.value}
            className="flex min-h-11 items-start gap-3 rounded-2xl border border-[var(--brand-line)] bg-white px-4 py-3 text-sm text-slate-700"
          >
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-emerald-600"
              checked={value.methods.includes(method.value)}
              onChange={() => {
                const nextMethods = toggleValue(value.methods, method.value);
                onChange({
                  ...value,
                  methods: nextMethods,
                  thirdPartyProviders: nextMethods.includes('third_party_manual')
                    ? value.thirdPartyProviders
                    : [],
                });
              }}
            />
            <span>
              <span className="block font-medium text-[var(--brand-ink)]">{method.label}</span>
              <span className="mt-0.5 block text-xs leading-5 text-slate-500">{method.detail}</span>
            </span>
          </label>
        ))}
      </div>

      {value.methods.includes('third_party_manual') && (
        <div className="space-y-2 rounded-2xl border border-amber-200 bg-amber-50/70 p-3">
          <p className={labelClass}>Manually arranged providers</p>
          <p className="text-xs leading-5 text-amber-900/75">
            These providers are manually arranged in this release; Booka does not book a rider automatically.
          </p>
          <div className="flex flex-wrap gap-2">
            {providers.map((provider) => (
              <label key={provider.value} className="flex min-h-11 items-center gap-2 rounded-full border border-amber-200 bg-white px-4 py-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-emerald-600"
                  checked={value.thirdPartyProviders.includes(provider.value)}
                  onChange={() => onChange({
                    ...value,
                    thirdPartyProviders: toggleValue(value.thirdPartyProviders, provider.value),
                  })}
                />
                {provider.label}
              </label>
            ))}
          </div>
        </div>
      )}

      <div>
        <label htmlFor={`${id}-areas`} className={labelClass}>Areas normally served (optional)</label>
        <input
          id={`${id}-areas`}
          className={inputClass}
          value={value.serviceAreas}
          onChange={(event) => onChange({ ...value, serviceAreas: event.target.value })}
          placeholder="e.g. Lekki, Victoria Island, Ikoyi"
        />
        <p className="mt-1 text-xs text-slate-500">Separate multiple areas with commas.</p>
      </div>

      <div>
        <label htmlFor={`${id}-fee-policy`} className={labelClass}>How is the delivery fee determined?</label>
        <select
          id={`${id}-fee-policy`}
          className={inputClass}
          value={value.feePolicy}
          onChange={(event) => onChange({
            ...value,
            feePolicy: event.target.value as RetailDeliveryFeePolicy,
            fixedFeeNaira: event.target.value === 'fixed' ? value.fixedFeeNaira : '',
          })}
        >
          <option value="included">Included in product prices</option>
          <option value="fixed">One fixed delivery fee</option>
          <option value="quote_required">Quoted for each order</option>
          <option value="manual">Arranged manually</option>
        </select>
      </div>

      {value.feePolicy === 'fixed' && (
        <div>
          <label htmlFor={`${id}-fixed-fee`} className={labelClass}>Fixed delivery fee (NGN)</label>
          <input
            id={`${id}-fixed-fee`}
            className={inputClass}
            value={value.fixedFeeNaira}
            onChange={(event) => onChange({ ...value, fixedFeeNaira: event.target.value })}
            inputMode="decimal"
            placeholder="e.g. 2500"
          />
        </div>
      )}

      <div>
        <label htmlFor={`${id}-notice`} className={labelClass}>Customer-facing note (optional)</label>
        <textarea
          id={`${id}-notice`}
          className={`${inputClass} min-h-24 resize-y`}
          value={value.customerNotice}
          onChange={(event) => onChange({ ...value, customerNotice: event.target.value })}
          maxLength={500}
          placeholder="e.g. Delivery timing is confirmed in chat."
        />
      </div>

      {error && (
        <p id={`${id}-error`} role="alert" aria-live="polite" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}
    </fieldset>
  );
}
