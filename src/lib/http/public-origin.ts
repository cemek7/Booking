type PublicOriginRequest = {
  url: string;
  headers: Pick<Headers, 'get'>;
};

const INTERNAL_IPV4 = [
  /^10\./,
  /^127\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
];

function firstForwardedValue(value: string | null): string | null {
  const first = value?.split(',')[0]?.trim();
  return first || null;
}

function isInternalHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '0.0.0.0' ||
    hostname.endsWith('.local') ||
    INTERNAL_IPV4.some((pattern) => pattern.test(hostname))
  );
}

function parseOrigin(value: string, label: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid ${label}`);
  }

  const localHttp = parsed.protocol === 'http:' && isInternalHostname(parsed.hostname);
  if (
    (parsed.protocol !== 'https:' && !localHttp) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`Invalid ${label}`);
  }

  return parsed;
}

function configuredOriginValue(): string | null {
  return (
    process.env.APP_PUBLIC_URL ||
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    null
  );
}

function isTrustedForwardedHostname(hostname: string): boolean {
  if (
    hostname === 'techclave.cloud' ||
    hostname.endsWith('.techclave.cloud') ||
    isInternalHostname(hostname)
  ) {
    return true;
  }

  const configured = configuredOriginValue();
  if (!configured) return false;
  try {
    return parseOrigin(configured, 'configured public origin').hostname === hostname;
  } catch {
    return false;
  }
}

export function getConfiguredPublicOrigin(): string {
  const configured = configuredOriginValue();
  if (!configured) throw new Error('APP_PUBLIC_URL is required');
  const parsed = parseOrigin(configured, 'APP_PUBLIC_URL');
  return parsed.origin;
}

export function getPublicOrigin(request: PublicOriginRequest): string {
  const forwardedHost = firstForwardedValue(request.headers.get('x-forwarded-host'));
  const forwardedProto = firstForwardedValue(request.headers.get('x-forwarded-proto'));

  if (forwardedHost || forwardedProto) {
    if (!forwardedHost || !forwardedProto || !/^[A-Za-z0-9.:-]+$/.test(forwardedHost)) {
      throw new Error('Invalid public origin');
    }
    const forwarded = parseOrigin(`${forwardedProto}://${forwardedHost}`, 'public origin');
    if (!isTrustedForwardedHostname(forwarded.hostname)) {
      throw new Error('Invalid public origin');
    }
    return forwarded.origin;
  }

  const requestUrl = new URL(request.url);
  if (!isInternalHostname(requestUrl.hostname)) {
    return parseOrigin(requestUrl.origin, 'public origin').origin;
  }

  return getConfiguredPublicOrigin();
}

export function buildPublicUrl(request: PublicOriginRequest, path: string): URL {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new Error('Invalid internal path');
  }
  return new URL(path, getPublicOrigin(request));
}
