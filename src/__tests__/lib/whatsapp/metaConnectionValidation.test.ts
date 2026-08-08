import { jest } from '@jest/globals';

jest.mock('@/lib/fetchWithTimeout', () => ({ fetchWithTimeout: jest.fn() }));
jest.mock('@/lib/whatsapp/providerSecrets', () => ({ getStoredProviderApiKey: jest.fn() }));

import { fetchWithTimeout } from '@/lib/fetchWithTimeout';
import { getStoredProviderApiKey } from '@/lib/whatsapp/providerSecrets';
import {
  revalidateActiveMetaConnections,
  verifyMetaPhoneBelongsToWaba,
} from '@/lib/whatsapp/metaConnectionValidation';

const mockFetch = jest.mocked(fetchWithTimeout);
const mockGetStoredProviderApiKey = jest.mocked(getStoredProviderApiKey);
const metaConfig = { apiBase: 'https://graph.example/v18.0' };

function response(status: number, body: unknown = {}): Response {
  return { ok: status >= 200 && status < 300, status, json: jest.fn().mockResolvedValue(body) } as unknown as Response;
}

describe('Meta WABA ownership validation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('accepts a phone number that belongs to the supplied WABA', async () => {
    mockFetch.mockResolvedValue(response(200, { data: [{ id: 'phone-1' }] }));

    await expect(verifyMetaPhoneBelongsToWaba(metaConfig, 'waba-1', 'phone-1', 'token')).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/waba-1/phone_numbers?fields=id&limit=500'),
      expect.objectContaining({ headers: { Authorization: 'Bearer token' } }),
    );
  });

  it('rejects a phone number from a different WABA', async () => {
    mockFetch.mockResolvedValue(response(200, { data: [{ id: 'phone-other' }] }));

    await expect(verifyMetaPhoneBelongsToWaba(metaConfig, 'waba-1', 'phone-1', 'token'))
      .rejects.toThrow('not part of the supplied WhatsApp Business Account');
  });
});

describe('Meta credential revalidation', () => {
  beforeEach(() => jest.clearAllMocks());

  function adminFor(connections: unknown[]) {
    const configUpdate = { eq: jest.fn().mockReturnThis() };
    const secretUpdate = { eq: jest.fn().mockReturnThis() };
    const configSelect = {
      eq: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ data: connections, error: null }),
    };
    const eventInsert = jest.fn().mockResolvedValue({ error: null });
    return {
      from: jest.fn((table: string) => {
        if (table === 'whatsapp_configurations') {
          return {
            select: jest.fn(() => configSelect),
            update: jest.fn(() => configUpdate),
          };
        }
        if (table === 'whatsapp_provider_secrets') return { update: jest.fn(() => secretUpdate) };
        if (table === 'tenant_meta_connection_events') return { insert: eventInsert };
        throw new Error(`unexpected table ${table}`);
      }),
      configUpdate,
      eventInsert,
    };
  }

  it('marks a connection action_required and inactive when its credential cannot be used', async () => {
    const admin = adminFor([{
      tenant_id: 'tenant-1', meta_waba_id: 'waba-1', meta_phone_number_id: 'phone-1', meta_connection_source: 'direct',
    }]);
    mockGetStoredProviderApiKey.mockResolvedValue('');

    const result = await revalidateActiveMetaConnections(admin as never, metaConfig);

    expect(result).toMatchObject({ checked: 1, healthy: 0, actionRequired: 1 });
    expect(admin.configUpdate.eq).toHaveBeenCalledWith('tenant_id', 'tenant-1');
    expect(admin.eventInsert).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'validation_failed',
      tenant_id: 'tenant-1',
    }));
  });

  it('keeps a healthy connection active after checking the phone and WABA relationship', async () => {
    const admin = adminFor([{
      tenant_id: 'tenant-1', meta_waba_id: 'waba-1', meta_phone_number_id: 'phone-1', meta_connection_source: 'embedded_signup',
    }]);
    mockGetStoredProviderApiKey.mockResolvedValue('token');
    mockFetch
      .mockResolvedValueOnce(response(200))
      .mockResolvedValueOnce(response(200, { data: [{ id: 'phone-1' }] }));

    const result = await revalidateActiveMetaConnections(admin as never, metaConfig);

    expect(result).toMatchObject({ checked: 1, healthy: 1, actionRequired: 0 });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(admin.eventInsert).not.toHaveBeenCalled();
  });
});
