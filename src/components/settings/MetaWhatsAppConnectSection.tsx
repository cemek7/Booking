'use client';

import { useEffect, useState } from 'react';
import { toast } from '@/components/ui/toast';

declare global {
  interface Window {
    FB?: { init: (options: Record<string, unknown>) => void; login: (callback: (response: { authResponse?: { code?: string } }) => void, options: Record<string, unknown>) => void };
  }
}

type Connection = {
  meta_connection_status?: string | null;
  meta_phone_number_id?: string | null;
  meta_waba_id?: string | null;
  meta_connection_source?: string | null;
  meta_last_error?: string | null;
};

export function MetaWhatsAppConnectSection({ tenantId }: { tenantId: string }) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [configured, setConfigured] = useState(false);
  const [embeddedSignup, setEmbeddedSignup] = useState<{ appId: string; configId: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    fetch(`/api/tenants/${tenantId}/whatsapp/meta/embedded-signup`)
      .then(async (res) => {
        if (!res.ok) throw new Error('Unable to load WhatsApp connection status');
        return res.json() as Promise<{ configured: boolean; connection: Connection | null; embeddedSignup?: { appId: string; configId: string } | null }>;
      })
      .then((data) => { setConfigured(data.configured); setConnection(data.connection); setEmbeddedSignup(data.embeddedSignup ?? null); })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'Unable to load WhatsApp connection status'))
      .finally(() => setLoading(false));
  }, [tenantId]);

  async function complete(code: string, details: { wabaId?: string; phoneNumberId?: string; businessAccountId?: string }) {
    if (!details.wabaId || !details.phoneNumberId) {
      throw new Error('Meta did not return a WhatsApp Business Account and phone number. Complete the WhatsApp setup in the Meta window, then try again.');
    }
    const response = await fetch(`/api/tenants/${tenantId}/whatsapp/meta/embedded-signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, ...details }),
    });
    const data = await response.json().catch(() => ({})) as { error?: string; message?: string; phoneNumberId?: string; wabaId?: string };
    if (!response.ok) throw new Error(data.message || data.error || 'Could not connect WhatsApp');
    setConnection({ meta_connection_status: 'connected', meta_phone_number_id: data.phoneNumberId, meta_waba_id: data.wabaId });
    toast.success('WhatsApp connected. Your Meta billing remains owned by your business.');
  }

  async function connect() {
    const appId = embeddedSignup?.appId;
    const configId = embeddedSignup?.configId;
    if (!appId || !configId) {
      toast.error('WhatsApp self-connection is not enabled on this environment yet. Contact Booka support to complete your connection.');
      return;
    }
    setConnecting(true);
    try {
      await new Promise<void>((resolve, reject) => {
        if (window.FB) return resolve();
        const script = document.createElement('script');
        script.src = 'https://connect.facebook.net/en_US/sdk.js';
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Could not load Meta Embedded Signup'));
        document.body.appendChild(script);
      });
      window.FB!.init({ appId, cookie: true, xfbml: false, version: 'v18.0' });

      let finishTimeout: ReturnType<typeof setTimeout> | undefined;
      const receiveMessage = (event: MessageEvent) => {
        if (!/^https:\/\/(www\.)?facebook\.com$/.test(event.origin)) return;
        const payload = typeof event.data === 'string' ? (() => { try { return JSON.parse(event.data); } catch { return null; } })() : event.data;
        if (!payload || payload.type !== 'WA_EMBEDDED_SIGNUP') return;
        if (payload.event === 'CANCEL' || payload.event === 'ERROR') {
          finishReject?.(new Error('Meta Embedded Signup was cancelled or could not complete'));
          return;
        }
        if (payload.event !== 'FINISH') return;
        finishResolve?.({
          wabaId: payload.data?.waba_id,
          phoneNumberId: payload.data?.phone_number_id,
          businessAccountId: payload.data?.business_id,
        });
      };
      let finishResolve: ((details: { wabaId?: string; phoneNumberId?: string; businessAccountId?: string }) => void) | undefined;
      let finishReject: ((reason: Error) => void) | undefined;
      const finishPromise = new Promise<{ wabaId?: string; phoneNumberId?: string; businessAccountId?: string }>((resolve, reject) => {
        finishResolve = resolve;
        finishReject = reject;
        finishTimeout = setTimeout(() => reject(new Error('Meta did not confirm the selected WhatsApp account in time')), 90_000);
      });
      window.addEventListener('message', receiveMessage);

      const codePromise = new Promise<string>((resolve, reject) => {
        window.FB!.login((response) => {
          const code = response.authResponse?.code;
          if (!code) return reject(new Error('Meta connection was cancelled or did not return an authorization code'));
          resolve(code);
        }, {
          config_id: configId,
          response_type: 'code',
          override_default_response_type: true,
          extras: { featureType: 'whatsapp_business_messaging' },
        });
      });
      try {
        const [code, details] = await Promise.all([codePromise, finishPromise]);
        await complete(code, details);
      } finally {
        if (finishTimeout) clearTimeout(finishTimeout);
        window.removeEventListener('message', receiveMessage);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not connect WhatsApp');
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    setDisconnecting(true);
    try {
      const response = await fetch(`/api/tenants/${tenantId}/whatsapp/meta/embedded-signup`, { method: 'DELETE' });
      const data = await response.json().catch(() => ({})) as { warning?: string | null };
      if (!response.ok) throw new Error('Could not disconnect WhatsApp');
      setConnection((current) => current ? { ...current, meta_connection_status: 'disconnected' } : null);
      toast.success(data.warning ? 'WhatsApp disconnected; Meta webhook removal needs a follow-up check.' : 'WhatsApp disconnected and credentials revoked.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not disconnect WhatsApp');
    } finally {
      setDisconnecting(false);
    }
  }

  const isConnected = connection?.meta_connection_status === 'connected';
  return (
    <section className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-4 space-y-3">
      <div>
        <h3 className="font-medium text-emerald-950">WhatsApp Business connection</h3>
        <p className="mt-1 text-xs text-emerald-900">Connect your own WhatsApp Business Account and phone number. Your business remains responsible for any Meta messaging charges; Booka does not collect your payment-card information.</p>
      </div>
      {loading ? <p className="text-sm text-gray-500">Loading connection status…</p> : isConnected ? (
        <div className="text-sm text-emerald-950">
          <p className="font-medium">Connected</p>
          <p>Phone ID: {connection?.meta_phone_number_id}</p>
          <p className="text-xs mt-1">Billing owner: your business (client payment method).</p>
          <button type="button" onClick={disconnect} disabled={disconnecting} className="mt-3 rounded border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-800 disabled:opacity-60">
            {disconnecting ? 'Disconnecting…' : 'Disconnect WhatsApp'}
          </button>
        </div>
      ) : (
        <>
          {connection?.meta_last_error && <p className="text-sm text-rose-700">Last connection issue: {connection.meta_last_error}</p>}
          <button type="button" onClick={connect} disabled={connecting || !configured || !embeddedSignup} className="rounded bg-emerald-700 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60">
            {connecting ? 'Connecting…' : configured ? 'Connect WhatsApp' : 'Connect WhatsApp (coming soon)'}
          </button>
          {(!configured || !embeddedSignup) && <p className="text-xs text-gray-600">Booka is waiting for Meta Partner/Embedded Signup configuration in this environment.</p>}
        </>
      )}
    </section>
  );
}
