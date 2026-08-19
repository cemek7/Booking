import { computeFileHash, ingestMedia } from './ingest';

describe('ingestMedia', () => {
  it('computes a deterministic sha256 hash for identical bytes', () => {
    const a = Buffer.from('same-bytes');
    const b = Buffer.from('same-bytes');

    expect(computeFileHash(a)).toBe(computeFileHash(b));
  });

  it('uploads to storage and creates media + extraction job records', async () => {
    const upload = jest.fn().mockResolvedValue({ error: null });
    const storageFrom = jest.fn().mockReturnValue({ upload });

    const mediaSingle = jest.fn().mockResolvedValue({ data: { id: 'media-1' }, error: null });
    const mediaSelect = jest.fn().mockReturnValue({ single: mediaSingle });
    const mediaInsert = jest.fn().mockReturnValue({ select: mediaSelect });

    const jobSingle = jest.fn().mockResolvedValue({ data: { id: 'job-1' }, error: null });
    const jobSelect = jest.fn().mockReturnValue({ single: jobSingle });
    const jobInsert = jest.fn().mockReturnValue({ select: jobSelect });

    const from = jest.fn((table: string) => {
      if (table === 'media_inputs') return { insert: mediaInsert };
      if (table === 'extraction_jobs') return { insert: jobInsert };
      throw new Error(`Unexpected table ${table}`);
    });

    const admin = {
      storage: { from: storageFrom },
      from,
    } as unknown as Parameters<typeof ingestMedia>[0];

    const result = await ingestMedia(admin, 'tenant-1', {
      kind: 'receipt',
      buffer: Buffer.from('file-bytes'),
      mime: 'image/png',
      uploadedBy: 'user-1',
      fileName: 'receipt.png',
      metadata: { source_message_id: 'msg-1' },
    });

    expect(storageFrom).toHaveBeenCalledWith('whatsapp-media');
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][0]).toMatch(/^tenant-1\/capture\//);
    expect(mediaInsert).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: 'tenant-1',
      kind: 'receipt',
      file_hash: expect.any(String),
      uploaded_by: 'user-1',
    }));
    expect(jobInsert).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: 'tenant-1',
      media_input_id: 'media-1',
      status: 'pending',
    }));
    expect(result).toEqual(expect.objectContaining({
      mediaInputId: 'media-1',
      extractionJobId: 'job-1',
      hash: expect.any(String),
      storagePath: expect.stringMatching(/^tenant-1\/capture\//),
    }));
  });
});
