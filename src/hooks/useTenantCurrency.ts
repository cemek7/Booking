'use client';

import { useQuery } from '@tanstack/react-query';
import { useTenant } from '@/lib/supabase/tenant-context';
import { authFetch } from '@/lib/auth/auth-api-client';

// Currency → locale for correct symbol + grouping. NGN is the primary market.
export const CURRENCY_LOCALE: Record<string, string> = {
  NGN: 'en-NG',
  GHS: 'en-GH',
  KES: 'en-KE',
  ZAR: 'en-ZA',
  USD: 'en-US',
  GBP: 'en-GB',
  EUR: 'en-IE',
};

/**
 * The tenant's default display currency (from settings), defaulting to NGN —
 * Booka's primary market — rather than USD. Returns a `format` helper so tables
 * render prices consistently. Amounts are passed in MAJOR units unless
 * `fromCents` is set.
 */
export function useTenantCurrency() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id;

  const { data: currency = 'NGN' } = useQuery({
    queryKey: ['tenant-currency', tenantId],
    enabled: !!tenantId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const r = await authFetch<{ defaultCurrency?: string }>(`/api/tenants/${tenantId}/settings`);
      const code = r.data?.defaultCurrency;
      return typeof code === 'string' && code.length === 3 ? code.toUpperCase() : 'NGN';
    },
  });

  const locale = CURRENCY_LOCALE[currency] ?? undefined;

  const format = (amount: number, opts?: { fromCents?: boolean }) => {
    const value = opts?.fromCents ? (amount || 0) / 100 : amount || 0;
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
    } catch {
      return `${currency} ${value.toFixed(2)}`;
    }
  };

  return { currency, locale, format };
}
