/**
 * Fetch wrapper with timeout support to prevent cascade failures
 * from unresponsive external services.
 * Uses AbortSignal.timeout() when available (Node.js >= 17.3),
 * with a manual AbortController fallback for older runtimes.
 */
export function fetchWithTimeout(
  url: string | URL | Request,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = 10_000, ...fetchOptions } = options;

  // Use native AbortSignal.timeout if available (Node >= 17.3)
  if (typeof AbortSignal.timeout === 'function') {
    return fetch(url, {
      ...fetchOptions,
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  // Polyfill for environments without AbortSignal.timeout
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...fetchOptions, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}
