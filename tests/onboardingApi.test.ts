import { NextRequest } from 'next/server';
import { POST as onboardingPOST } from '@/app/api/onboarding/tenant/route';

describe('Onboarding API', () => {
  const OLD_ENV = { ...process.env };
  beforeEach(() => { jest.resetModules(); process.env = { ...OLD_ENV }; });
  afterAll(() => { process.env = OLD_ENV; });

  it('returns dev fallback when service env missing', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const req = new NextRequest('http://x/api/onboarding/tenant', { method: 'POST', body: JSON.stringify({ name: 'My Biz' }) });
    const res = await onboardingPOST(req);
    expect(res.status).toBe(200);
  });
});
