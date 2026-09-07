"use client";

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { authFetch } from '@/lib/auth/auth-api-client';
import { Button } from '@/components/ui/button';
import { FormSection } from './FormSection';

const STATUS_MESSAGES: Record<string, { text: string; tone: 'ok' | 'error' }> = {
  connected: { text: 'Instagram connected. Customer DMs will now flow into your inbox.', tone: 'ok' },
  denied: { text: 'Connection cancelled — you declined on the Instagram screen.', tone: 'error' },
  invalid_state: { text: 'Connection expired or could not be verified. Please try again.', tone: 'error' },
  missing_code: { text: 'Instagram did not return an authorization code. Please try again.', tone: 'error' },
  not_configured: { text: 'Instagram is not configured on this server yet. Contact support.', tone: 'error' },
  error: { text: 'Something went wrong connecting Instagram. Please try again.', tone: 'error' },
};

export function InstagramConnectSection({ tenantId }: { tenantId: string }) {
  const params = useSearchParams();
  const status = params.get('instagram');
  const banner = status ? STATUS_MESSAGES[status] : null;
  const [connection, setConnection] = useState<{ status: string; instagramAccountId?: string | null; tokenExpiresAt?: string | null } | null>(null);
  useEffect(() => { authFetch<{ status: string; instagramAccountId?: string | null; tokenExpiresAt?: string | null }>(`/api/tenants/${tenantId}/instagram/connection`, { tenantId }).then(r => setConnection(r.data ?? null)).catch(() => setConnection(null)); }, [tenantId]);
  const disconnect = async () => {
    const response = await authFetch(`/api/tenants/${tenantId}/instagram/connection`, { method: 'DELETE', tenantId });
    if (response.data) setConnection({ status: 'disconnected' });
  };

  return (
    <FormSection
      title="Instagram DMs"
      description="Let customers start a booking from your Instagram DMs. Replies use the same AI front desk as WhatsApp."
    >
      {banner && (
        <div
          className={`mb-3 rounded border px-3 py-2 text-xs ${
            banner.tone === 'ok'
              ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
              : 'border-red-300 bg-red-50 text-red-700'
          }`}
        >
          {banner.text}
        </div>
      )}

      <p className="mb-3 text-xs text-gray-500">
        Instagram only allows replies within 24 hours of a customer&apos;s message, so it is
        best for capturing new enquiries — WhatsApp stays your channel for reminders and
        follow-ups. You connect your own Instagram professional account; nothing is shared
        across tenants.
      </p>

      {connection?.status === 'connected' ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700">Connected</span>
          <button type="button" onClick={disconnect} className="rounded-md border border-rose-200 bg-white px-3 py-1.5 text-sm font-medium text-rose-700 transition hover:bg-rose-50">
            Disconnect
          </button>
        </div>
      ) : (
        <Button asChild size="sm">
          <a href={`/api/auth/instagram/start?tenant_id=${encodeURIComponent(tenantId)}`}>
            {connection?.status === 'action_required' ? 'Reconnect Instagram' : 'Connect Instagram'}
          </a>
        </Button>
      )}
    </FormSection>
  );
}
