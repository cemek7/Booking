'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

type State = { kind: 'working' } | { kind: 'done'; list: string } | { kind: 'error' };

function UnsubscribeInner() {
  const token = useSearchParams().get('token');
  const [state, setState] = useState<State>({ kind: 'working' });

  useEffect(() => {
    if (!token) {
      setState({ kind: 'error' });
      return;
    }
    fetch('/api/email/unsubscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d?.success) setState({ kind: 'done', list: d.list ?? 'these emails' });
        else setState({ kind: 'error' });
      })
      .catch(() => setState({ kind: 'error' }));
  }, [token]);

  return (
    <div className="mx-auto w-full max-w-md px-5 py-16 text-center">
      <h1 className="text-2xl font-semibold text-[#10211a]">Email preferences</h1>
      {state.kind === 'working' && <p className="mt-4 text-sm text-[#3a4a43]">Updating your preferences…</p>}
      {state.kind === 'done' && (
        <p className="mt-4 text-sm text-[#3a4a43]">
          You&apos;ve been unsubscribed from <strong>{state.list}</strong>. You may still receive
          essential transactional messages (e.g. booking confirmations).
        </p>
      )}
      {state.kind === 'error' && (
        <p className="mt-4 text-sm text-red-700">
          This unsubscribe link is invalid or has expired. Please use the link from a recent email,
          or contact support.
        </p>
      )}
    </div>
  );
}

export default function UnsubscribePage() {
  return (
    <main className="min-h-screen bg-[#f6f5ef]">
      <Suspense fallback={null}>
        <UnsubscribeInner />
      </Suspense>
    </main>
  );
}
