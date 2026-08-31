'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/components/ui/toast';

declare global {
  interface Window {
    FB?: { init: (options: Record<string, unknown>) => void; login: (callback: (response: { authResponse?: { code?: string } }) => void, options: Record<string, unknown>) => void };
  }
}

type Connection = {
  agent_enabled?: boolean | null;
  meta_connection_status?: string | null;
  meta_phone_number_id?: string | null;
  meta_waba_id?: string | null;
  meta_connection_source?: string | null;
};

type ChannelHealth = {
  connection: { status: string; lastValidatedAt: string | null; webhookSubscribedAt: string | null };
  automation: {
    agentEnabled: boolean;
    state: 'ready' | 'paused' | 'human_handling' | 'attention';
    humanHandlingUntil: string | null;
    lastInboundAt: string | null;
    lastQueueActivityAt: string | null;
    recentFailure: string | null;
  };
  queue: { pending: number; processing: number; retrying: number; failed: number };
};

function relativeTime(value: string | null): string {
  if (!value) return 'No activity yet';
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60_000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return new Date(value).toLocaleDateString();
}

export function MetaWhatsAppConnectSection({ tenantId }: { tenantId: string }) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [configured, setConfigured] = useState(false);
  const [embeddedSignup, setEmbeddedSignup] = useState<{ appId: string; configId: string; apiVersion: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [updatingAgent, setUpdatingAgent] = useState(false);
  const [health, setHealth] = useState<ChannelHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  useEffect(() => {
    fetch(`/api/tenants/${tenantId}/whatsapp/meta/embedded-signup`)
      .then(async (res) => {
        if (!res.ok) throw new Error('Unable to load WhatsApp connection status');
        return res.json() as Promise<{ configured: boolean; connection: Connection | null; embeddedSignup?: { appId: string; configId: string; apiVersion: string } | null }>;
      })
      .then((data) => { setConfigured(data.configured); setConnection(data.connection); setEmbeddedSignup(data.embeddedSignup ?? null); })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'Unable to load WhatsApp connection status'))
      .finally(() => setLoading(false));
  }, [tenantId]);

  const loadHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const response = await fetch(`/api/tenants/${tenantId}/whatsapp/meta/health`);
      if (!response.ok) throw new Error('Unable to load channel health');
      setHealth(await response.json() as ChannelHealth);
    } catch {
      setHealth(null);
    } finally {
      setHealthLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (connection?.meta_connection_status === 'connected') void loadHealth();
  }, [connection?.meta_connection_status, loadHealth]);

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
      window.FB!.init({ appId, cookie: true, xfbml: false, version: embeddedSignup.apiVersion });

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
      setHealth(null);
      toast.success(data.warning ? 'WhatsApp disconnected; Meta webhook removal needs a follow-up check.' : 'WhatsApp disconnected and credentials revoked.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not disconnect WhatsApp');
    } finally {
      setDisconnecting(false);
    }
  }

  async function updateAgentEnabled(agentEnabled: boolean) {
    setUpdatingAgent(true);
    try {
      const response = await fetch(`/api/tenants/${tenantId}/whatsapp/meta/embedded-signup`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentEnabled }),
      });
      const data = await response.json().catch(() => ({})) as { agentEnabled?: boolean; error?: string; message?: string };
      if (!response.ok) throw new Error(data.message || data.error || 'Could not update the AI reply setting');
      setConnection((current) => current ? { ...current, agent_enabled: data.agentEnabled === true } : current);
      void loadHealth();
      toast.success(agentEnabled ? 'AI replies are enabled for customer messages.' : 'AI replies are paused. Customer messages will still be received.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update the AI reply setting');
    } finally {
      setUpdatingAgent(false);
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
          <div className="mt-4 rounded-md border border-emerald-200 bg-white/80 p-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-medium">AI customer replies</p>
                <p className="mt-1 text-xs text-emerald-900">When paused, Booka still receives and records customer messages but sends no automated reply, disclosure, or booking action.</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={connection?.agent_enabled === true}
                onClick={() => updateAgentEnabled(connection?.agent_enabled !== true)}
                disabled={updatingAgent}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium disabled:opacity-60 ${connection?.agent_enabled === true ? 'bg-emerald-700 text-white' : 'border border-gray-300 bg-white text-gray-700'}`}
              >
                {updatingAgent ? 'Saving…' : connection?.agent_enabled === true ? 'Enabled' : 'Paused'}
              </button>
            </div>
          </div>
          <div className="mt-3 rounded-md border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-medium text-slate-900">Automation status</p>
                <p className="mt-0.5 text-xs text-slate-600">Live, redacted health for this connected number.</p>
              </div>
              <button type="button" onClick={() => void loadHealth()} disabled={healthLoading} className="rounded border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-60">
                {healthLoading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
            {health ? (
              <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                <div className={`rounded p-2 ${health.automation.state === 'ready' ? 'bg-emerald-50 text-emerald-900' : health.automation.state === 'attention' ? 'bg-rose-50 text-rose-900' : 'bg-amber-50 text-amber-900'}`}>
                  <p className="font-medium">
                    {health.automation.state === 'ready'
                      ? 'AI replies are ready'
                      : health.automation.state === 'paused'
                        ? 'AI replies are paused'
                        : health.automation.state === 'human_handling'
                          ? 'A teammate is handling the latest conversation'
                          : 'Automation needs attention'}
                  </p>
                  <p className="mt-1">
                    {health.automation.recentFailure
                      || (health.automation.state === 'human_handling'
                        ? `Human handling until ${relativeTime(health.automation.humanHandlingUntil)}`
                        : health.automation.state === 'paused'
                          ? 'Messages are received and recorded without automated replies.'
                          : 'Customer messages can be processed automatically.')}
                  </p>
                </div>
                <div className="rounded bg-slate-50 p-2 text-slate-700">
                  <p className="font-medium text-slate-900">Recent activity</p>
                  <p className="mt-1">Inbound: {relativeTime(health.automation.lastInboundAt)}</p>
                  <p>Queue: {relativeTime(health.automation.lastQueueActivityAt)}</p>
                </div>
                <div className="rounded bg-slate-50 p-2 text-slate-700 sm:col-span-2">
                  <p className="font-medium text-slate-900">Message queue</p>
                  <p className="mt-1">
                    {health.queue.pending} pending · {health.queue.processing} processing · {health.queue.retrying} retrying · {health.queue.failed} failed
                  </p>
                </div>
              </div>
            ) : !healthLoading ? <p className="mt-3 text-xs text-slate-600">Health data is temporarily unavailable. Your connection and reply setting are unchanged.</p> : null}
          </div>
          <button type="button" onClick={disconnect} disabled={disconnecting} className="mt-3 rounded border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-800 disabled:opacity-60">
            {disconnecting ? 'Disconnecting…' : 'Disconnect WhatsApp'}
          </button>
        </div>
      ) : (
        <>
          {connection?.meta_connection_status === 'failed' && (
            <p className="text-sm text-rose-700">
              Booka could not complete the last connection attempt. Check that the selected Meta business account and number are active, then try again.
            </p>
          )}
          <button type="button" onClick={connect} disabled={connecting || !configured || !embeddedSignup} className="rounded bg-emerald-700 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60">
            {connecting ? 'Connecting…' : configured ? 'Connect WhatsApp' : 'Connect WhatsApp (coming soon)'}
          </button>
          {(!configured || !embeddedSignup) && <p className="text-xs text-gray-600">Booka is waiting for Meta Partner/Embedded Signup configuration in this environment.</p>}
        </>
      )}
    </section>
  );
}
