"use client";

import { useCallback, useEffect, useState } from 'react';
import { authGet, authPatch } from '@/lib/auth/auth-api-client';

type Escalation = {
  id: string;
  customer_phone: string;
  reason: string;
};

interface EscalationBannerProps {
  onOpenCustomer: (customerPhone: string) => void;
  onClaimed?: () => Promise<void> | void;
}

export default function EscalationBanner({ onOpenCustomer, onClaimed }: EscalationBannerProps) {
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadEscalations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await authGet<{ escalations?: Escalation[] }>('/api/escalation?status=pending');
      if (response.status >= 400) {
        throw new Error(response.error?.message || 'Failed to load escalations');
      }
      setEscalations(response.data?.escalations ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load escalations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEscalations();
  }, [loadEscalations]);

  const handleClaim = useCallback(async (escalation: Escalation) => {
    setError(null);
    const response = await authPatch(`/api/escalation/${encodeURIComponent(escalation.id)}`, {
      action: 'claim',
    });

    if (response.status >= 400) {
      setError(response.error?.message || 'Failed to claim escalation');
      return;
    }

    setEscalations((current) => current.filter((item) => item.id !== escalation.id));
    onOpenCustomer(escalation.customer_phone);
    await onClaimed?.();
  }, [onClaimed, onOpenCustomer]);

  if (loading) {
    return <div className="text-[11px] text-gray-500">Loading handoffs…</div>;
  }

  if (error) {
    return (
      <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
        {error}
      </div>
    );
  }

  if (escalations.length === 0) {
    return <div className="text-[11px] text-gray-500">No pending human handoffs.</div>;
  }

  return (
    <div className="space-y-2">
      <div className="text-[11px] font-medium text-gray-700">
        Pending human handoffs ({escalations.length})
      </div>
      <div className="space-y-2">
        {escalations.slice(0, 3).map((escalation) => (
          <div
            key={escalation.id}
            className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900"
          >
            <div className="font-medium">{escalation.reason}</div>
            <div className="text-amber-800">{escalation.customer_phone}</div>
            <div className="mt-2">
              <button
                type="button"
                onClick={() => void handleClaim(escalation)}
                className="rounded bg-amber-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-amber-700"
              >
                Claim
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
