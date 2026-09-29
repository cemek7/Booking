import { generateTenantExport } from '@/lib/offboarding/exporter';
import JSZip from 'jszip';

function makeAdmin() {
  const upload = jest.fn().mockResolvedValue({ data: { path: 'tenant-exports/t1/export.zip' }, error: null });
  const createSignedUrl = jest.fn().mockResolvedValue({ data: { signedUrl: 'https://x/export.zip' }, error: null });
  const selections: Array<{ table: string; columns: string }> = [];
  let table = '';
  const from = jest.fn((nextTable: string) => {
    table = nextTable;
    return {
      select: (columns: string) => {
        selections.push({ table, columns });
        return { eq: () => Promise.resolve({ data: [{ id: 'r1', metadata: { provider_token: 'never-export' } }], error: null }) };
      },
    };
  });
  return {
    admin: { from, storage: { from: jest.fn(() => ({ upload, createSignedUrl })) } },
    upload, createSignedUrl, selections,
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

  it('exports continuity data while excluding effect metadata that may contain provider data', async () => {
    const { admin, upload, selections } = makeAdmin();
    await generateTenantExport(admin as unknown as Parameters<typeof generateTenantExport>[0], 't1');

    expect(selections.map((entry) => entry.table)).toEqual(expect.arrayContaining([
      'shared_channel_route_sessions',
      'customer_channel_identities',
      'conversation_threads',
      'customer_memory_facts',
      'conversation_effects',
    ]));
    expect(selections.find((entry) => entry.table === 'conversation_effects')?.columns)
      .not.toContain('metadata');

    const buffer = upload.mock.calls[0]?.[1] as Buffer;
    const zip = await JSZip.loadAsync(buffer);
    for (const table of [
      'shared_channel_route_sessions', 'customer_channel_identities',
      'conversation_threads', 'customer_memory_facts', 'conversation_effects',
    ]) {
      expect(zip.file(`json/${table}.json`)).not.toBeNull();
      expect(zip.file(`csv/${table}.csv`)).not.toBeNull();
    }
  });
});
