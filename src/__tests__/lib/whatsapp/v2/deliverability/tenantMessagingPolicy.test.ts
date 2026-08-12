import { describe, expect, it, jest } from '@jest/globals';
import { loadTenantMessagingPolicy } from '@/lib/whatsapp/v2/deliverability/tenantMessagingPolicy';

function adminReturning(result: { data: unknown; error: unknown }) {
  const maybeSingle = jest.fn().mockResolvedValue(result);
  const eq = jest.fn(() => ({ maybeSingle }));
  const select = jest.fn(() => ({ eq }));
  const from = jest.fn(() => ({ select }));
  return { admin: { from }, from };
}

describe('loadTenantMessagingPolicy', () => {
  it('reads both explicit template approvals from canonical tenant settings', async () => {
    const { admin, from } = adminReturning({
      data: {
        settings: {
          channelConfig: {
            whatsapp: { templateMessagingEnabled: true, paidTemplateConsent: true },
          },
        },
      },
      error: null,
    });

    await expect(loadTenantMessagingPolicy(admin as never, 'tenant-1')).resolves.toEqual({
      templateMessagingEnabled: true,
      paidTemplateConsent: true,
    });
    expect(from).toHaveBeenCalledWith('tenants');
  });

  it('supports the legacy metadata.ui_settings storage shape', async () => {
    const { admin } = adminReturning({
      data: {
        settings: null,
        metadata: {
          ui_settings: {
            channelConfig: {
              whatsapp: { templateMessagingEnabled: true, paidTemplateConsent: true },
            },
          },
        },
      },
      error: null,
    });

    await expect(loadTenantMessagingPolicy(admin as never, 'tenant-1')).resolves.toEqual({
      templateMessagingEnabled: true,
      paidTemplateConsent: true,
    });
  });

  it('fails closed when settings cannot be read', async () => {
    const { admin } = adminReturning({ data: null, error: { message: 'database unavailable' } });

    await expect(loadTenantMessagingPolicy(admin as never, 'tenant-1')).resolves.toEqual({
      templateMessagingEnabled: false,
      paidTemplateConsent: false,
    });
  });
});
