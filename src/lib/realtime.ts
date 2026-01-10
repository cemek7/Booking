import { QueryClient } from '@tanstack/react-query';

interface RealtimeOptions { token: string; baseUrl?: string; queryClient: QueryClient; }

// Minimal websocket client for Booka realtime events
export function createRealtimeClient({ token, baseUrl = 'ws://api.booka.app/v1/realtime', queryClient }: RealtimeOptions) {
  let ws: WebSocket | null = null;
  let retry = 0;
  function connect() {
    ws = new WebSocket(`${baseUrl}?token=${encodeURIComponent(token)}`);
    ws.onopen = () => { retry = 0; };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        const { type, payload } = msg;
        if (type === 'booking.updated' && payload?.id) {
          queryClient.invalidateQueries({ queryKey: ['booking', payload.id] });
          if (payload.locationId) queryClient.invalidateQueries({ queryKey: ['bookings', payload.locationId] });
        }
        if (type === 'booking.created' && payload?.locationId) {
          queryClient.invalidateQueries({ queryKey: ['bookings', payload.locationId] });
        }
        if (type === 'message.created' && payload?.bookingId) {
          queryClient.invalidateQueries({ queryKey: ['messages', payload.bookingId] });
        }
        // Additional events (payment.updated, staff.updated) can be added similarly.
      } catch {}
    };
    ws.onclose = () => { scheduleReconnect(); };
    ws.onerror = () => { ws?.close(); };
  }
  function scheduleReconnect() {
    const delay = Math.min(30000, 1000 * Math.pow(2, retry++));
    setTimeout(() => connect(), delay);
  }
  connect();
  return { close: () => ws?.close() };
}
