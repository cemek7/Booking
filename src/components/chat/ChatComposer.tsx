"use client";
import { useState } from 'react';

interface ChatComposerProps {
  chatId?: string | null;
  onSend?: (text: string) => Promise<void> | void;
  onRelease?: () => Promise<void> | void;
  disabled?: boolean;
  channel?: 'whatsapp' | 'instagram';
  humanHandling?: boolean;
}

export function ChatComposer({
  chatId,
  onSend,
  onRelease,
  disabled,
  channel = 'whatsapp',
  humanHandling = false,
}: ChatComposerProps) {
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSend() {
    const text = value.trim();
    if (!text || sending || disabled) return;
    setSending(true);
    setError(null);
    try {
      await onSend?.(text);
      setValue('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  }

  async function handleRelease() {
    if (!chatId || releasing) return;
    setReleasing(true);
    setError(null);
    try {
      await onRelease?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to release chat to AI');
    } finally {
      setReleasing(false);
    }
  }

  return (
    <div className="border-t bg-white/90 backdrop-blur-sm p-3 space-y-2">
      {humanHandling ? (
        <div className="rounded border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] text-sky-800">
          You&apos;re handling this conversation. AI replies are paused until you release it.
        </div>
      ) : null}
      <textarea
        className="w-full resize-none border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        rows={3}
        placeholder={channel === 'instagram' ? 'Reply on Instagram...' : 'Type a message...'}
        value={value}
        onChange={e=>{ setValue(e.target.value); if (error) setError(null); }}
        disabled={disabled || sending}
        aria-label="Message composer"
      />
      {channel === 'instagram' ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          Instagram replies only work within 24 hours of the customer&apos;s last DM. Use WhatsApp for proactive follow-up.
        </div>
      ) : null}
      {error ? (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
          {error}
        </div>
      ) : null}
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-gray-500">Press Enter to send</div>
        <div className="flex items-center gap-2">
          {humanHandling ? (
            <button
              onClick={handleRelease}
              disabled={!chatId || releasing}
              className="px-3 py-1.5 rounded border border-gray-300 bg-white text-sm text-gray-700 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {releasing ? 'Releasing…' : 'Release to AI'}
            </button>
          ) : null}
          <button
            onClick={handleSend}
            disabled={disabled || sending || value.trim().length===0}
            className="px-4 py-1.5 rounded bg-indigo-600 text-white text-sm disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            aria-disabled={disabled || sending}
          >{sending ? 'Sending…' : 'Send'}</button>
        </div>
      </div>
    </div>
  );
}

export default ChatComposer;
