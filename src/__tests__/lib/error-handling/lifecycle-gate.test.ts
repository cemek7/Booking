import { isLifecycleAccessible } from '@/lib/error-handling/route-handler';

describe('isLifecycleAccessible', () => {
  it('allows active tenants', () => expect(isLifecycleAccessible('active', '/api/tenants/x/settings')).toBe(true));
  it('blocks non-active tenants on normal routes', () => expect(isLifecycleAccessible('scheduled_for_deletion', '/api/tenants/x/settings')).toBe(false));
  it('allows the export + reactivate routes during grace', () => {
    expect(isLifecycleAccessible('scheduled_for_deletion', '/api/tenants/x/export')).toBe(true);
    expect(isLifecycleAccessible('scheduled_for_deletion', '/api/tenants/x/reactivate')).toBe(true);
  });
});
