import {
  buildPublicUrl,
  getConfiguredPublicOrigin,
  getPublicOrigin,
} from './public-origin';

function requestFor(
  url: string,
  headers: Record<string, string> = {}
): { url: string; headers: Pick<Headers, 'get'> } {
  const normalized = new Map(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value])
  );
  return {
    url,
    headers: { get: (name: string) => normalized.get(name.toLowerCase()) ?? null },
  };
}

describe('public origin resolution', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.APP_PUBLIC_URL;
    delete process.env.APP_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.NEXT_PUBLIC_BASE_URL;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('keeps a staging forwarded host when a browser fallback points to production', () => {
    process.env.APP_PUBLIC_URL = 'https://staging.app.techclave.cloud';
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.techclave.cloud';

    expect(
      getPublicOrigin(
        requestFor('http://booka-staging-app:3000/api/test', {
          'x-forwarded-host': 'staging.app.techclave.cloud',
          'x-forwarded-proto': 'https',
        })
      )
    ).toBe('https://staging.app.techclave.cloud');
  });

  it('uses a real external request origin before configured fallbacks', () => {
    process.env.APP_PUBLIC_URL = 'https://app.techclave.cloud';
    expect(getPublicOrigin(requestFor('https://staging.app.techclave.cloud/api/test'))).toBe(
      'https://staging.app.techclave.cloud'
    );
  });

  it.each([
    ['evil.com\r\nX-Injection: yes', 'https'],
    ['user@staging.app.techclave.cloud', 'https'],
    ['staging.app.techclave.cloud:bad', 'https'],
    ['staging.app.techclave.cloud', 'javascript'],
  ])('rejects an unsafe forwarded origin', (host, protocol) => {
    process.env.APP_PUBLIC_URL = 'https://staging.app.techclave.cloud';
    expect(() =>
      getPublicOrigin(
        requestFor('http://booka-staging-app:3000/api/test', {
          'x-forwarded-host': host,
          'x-forwarded-proto': protocol,
        })
      )
    ).toThrow('Invalid public origin');
  });

  it('falls back from an internal container URL to APP_PUBLIC_URL', () => {
    process.env.APP_PUBLIC_URL = 'https://staging.app.techclave.cloud/';
    expect(getPublicOrigin(requestFor('http://10.0.0.8:3000/api/test'))).toBe(
      'https://staging.app.techclave.cloud'
    );
  });

  it('requires a safe configured origin for background work', () => {
    process.env.APP_PUBLIC_URL = 'https://staging.app.techclave.cloud/path';
    expect(() => getConfiguredPublicOrigin()).toThrow('Invalid APP_PUBLIC_URL');

    process.env.APP_PUBLIC_URL = 'https://staging.app.techclave.cloud';
    expect(getConfiguredPublicOrigin()).toBe('https://staging.app.techclave.cloud');
  });

  it('builds only internal public URLs', () => {
    const request = requestFor('https://staging.app.techclave.cloud/api/test');
    expect(buildPublicUrl(request, '/accept-invite').toString()).toBe(
      'https://staging.app.techclave.cloud/accept-invite'
    );
    expect(() => buildPublicUrl(request, '//evil.example/path')).toThrow(
      'Invalid internal path'
    );
  });
});
