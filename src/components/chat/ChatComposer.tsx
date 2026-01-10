"use client";
import { useState } from 'react';

interface ChatComposerProps {
  onSend?: (text: string) => Promise<void> | void;
  disabled?: boolean;
}

export function ChatComposer({ onSend, disabled }: ChatComposerProps) {
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);

  async function handleSend() {
    const text = value.trim();
    if (!text || sending || disabled) return;
    setSending(true);
    try { await onSend?.(text); setValue(''); } finally { setSending(false); }
  }

  return (
    <div className="border-t bg-white/90 backdrop-blur-sm p-3 space-y-2">
      <textarea
        className="w-full resize-none border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        rows={3}
        placeholder="Type a message..."
        value={value}
        onChange={e=>setValue(e.target.value)}
        disabled={disabled || sending}
        aria-label="Message composer"
      />
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-gray-500">Press Enter to send</div>
        <button
          onClick={handleSend}
          disabled={disabled || sending || value.trim().length===0}
          className="px-4 py-1.5 rounded bg-indigo-600 text-white text-sm disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          aria-disabled={disabled || sending}
        >{sending ? 'Sending…' : 'Send'}</button>
      </div>
    </div>
  );
}

export default ChatComposer;
