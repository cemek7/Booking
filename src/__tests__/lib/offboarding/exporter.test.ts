import { generateTenantExport } from '@/lib/offboarding/exporter';

function makeAdmin() {
  const upload = jest.fn().mockResolvedValue({ data: { path: 'tenant-exports/t1/export.zip' }, error: null });
  const createSignedUrl = jest.fn().mockResolvedValue({ data: { signedUrl: 'https://x/export.zip' }, error: null });
  const select = () => ({ eq: () => Promise.resolve({ data: [{ id: 'r1' }], error: null }) });
  return {
    admin: { from: jest.fn(() => ({ select })), storage: { from: jest.fn(() => ({ upload, createSignedUrl })) } },
    upload, createSignedUrl,
  };
}

describe('generateTenantExport', () => {
  it('builds a zip, uploads to tenant-exports, returns a signed url', async () => {
    const { admin, upload, createSignedUrl } = makeAdmin();
    const res = await generateTenantExport(admin as unknown as Parameters<typeof generateTenantExport>[0], 't1');
    expect(upload).toHaveBeenCalledWith(
      expect.stringContaining('t1/'),
      expect.anything(),
      expect.objectContaining({ contentType: 'application/zip', upsert: true }),
    );
    expect(createSignedUrl).toHaveBeenCalled();
    expect(res.url).toBe('https://x/export.zip');
  });
});
