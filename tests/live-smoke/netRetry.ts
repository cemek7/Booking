/**
 * Setup for the live-DB smoke: make network access resilient.
 *
 * The smoke talks to a remote Supabase over the public internet, so a transient
 * connection blip (ETIMEDOUT / ECONNRESET / undici "fetch failed") should not fail
 * an otherwise-passing run. We prefer IPv4 (some hosts stall on IPv6) and wrap the
 * global fetch with a small bounded backoff-retry. Production is unaffected — this
 * runs only under jest.livesmoke.config.cjs.
 */
import dns from 'node:dns';

dns.setDefaultResultOrder('ipv4first');

const originalFetch = globalThis.fetch;

function isTransient(err: unknown): boolean {
  const cause = (err as { cause?: { code?: string } } | undefined)?.cause;
  const code = cause?.code ?? (err as { code?: string } | undefined)?.code;
  const msg = (err as Error | undefined)?.message ?? '';
  return (
    msg.includes('fetch failed') ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'EAI_AGAIN'
  );
}

globalThis.fetch = (async (input: Parameters<typeof originalFetch>[0], init?: Parameters<typeof originalFetch>[1]) => {
  const maxAttempts = 5;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await originalFetch(input, init);
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts || !isTransient(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    }
  }
  throw lastErr;
}) as typeof fetch;
