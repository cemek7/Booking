// Generic WebSocket client with exponential backoff & event dispatch.
// Uses NEXT_PUBLIC_WS_BASE or falls back to Supabase realtime (not implemented here).

export type RealtimeStatus = 'connecting' | 'open' | 'closed' | 'error';
export type RealtimeEventHandler = (event: any) => void;

interface HandlerEntry { type: string; handler: RealtimeEventHandler }

export class RealtimeClient {
  private url: string;
  private token?: string;
  private ws?: WebSocket;
  private status: RealtimeStatus = 'closed';
  private handlers: HandlerEntry[] = [];
  private backoff = 1000;
  private maxBackoff = 15000;
  private shouldRun = true;
  private listeners: ((s: RealtimeStatus) => void)[] = [];

  constructor(url: string, token?: string) {
    this.url = url;
    this.token = token;
  }

  getStatus() { return this.status; }
  onStatus(listener: (s: RealtimeStatus)=>void) { this.listeners.push(listener); }
  private setStatus(s: RealtimeStatus) { this.status = s; this.listeners.forEach(l=>l(s)); }

  addHandler(type: string, handler: RealtimeEventHandler) {
    this.handlers.push({ type, handler });
  }
  removeHandler(handler: RealtimeEventHandler) {
    this.handlers = this.handlers.filter(h => h.handler !== handler);
  }

  start() {
    if (!this.shouldRun) return;
    this.setStatus('connecting');
    const wsUrl = this.token ? `${this.url}?token=${encodeURIComponent(this.token)}` : this.url;
    try {
      this.ws = new WebSocket(wsUrl);
      this.ws.onopen = () => {
        this.backoff = 1000;
        this.setStatus('open');
      };
      this.ws.onerror = () => {
        this.setStatus('error');
      };
      this.ws.onclose = () => {
        this.setStatus('closed');
        if (this.shouldRun) this.scheduleReconnect();
      };
      this.ws.onmessage = (msg) => {
        let payload: any;
        try { payload = JSON.parse(msg.data); } catch { payload = { type: 'raw', data: msg.data }; }
        if (!payload || typeof payload !== 'object') return;
        const type = payload.type || payload.event || 'unknown';
        this.handlers.filter(h=>h.type===type).forEach(h=>h.handler(payload));
        // Fan-out for generic handlers listening on '*'
        this.handlers.filter(h=>h.type==='*').forEach(h=>h.handler(payload));
      };
    } catch (e) {
      this.setStatus('error');
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    this.backoff = Math.min(this.backoff * 2, this.maxBackoff);
    setTimeout(()=>{ if (this.shouldRun) this.start(); }, this.backoff);
  }

  stop() {
    this.shouldRun = false;
    try { this.ws?.close(); } catch {}
    this.setStatus('closed');
  }
}

// Singleton accessor (simple)
let client: RealtimeClient | null = null;
export function getRealtimeClient(token?: string) {
  if (!client) {
    const base = process.env.NEXT_PUBLIC_WS_BASE || 'ws://localhost:3001/realtime';
    client = new RealtimeClient(base, token);
    client.start();
  }
  return client;
}
