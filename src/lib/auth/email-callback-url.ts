export function buildEmailTokenExchangeUrl(currentUrl: string): string | null {
  const url = new URL(currentUrl);
  if (!url.searchParams.get('token_hash')) return null;
  url.pathname = '/api/auth/callback';
  return url.toString();
}
