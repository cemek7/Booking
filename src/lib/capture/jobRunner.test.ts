import { processOnePendingCaptureJob } from './jobRunner';

jest.mock('./provider', () => ({
  createLiveCaptureProvider: jest.fn(() => ({ extract: jest.fn() })),
}));

jest.mock('./extract', () => ({
  extractAndPersistRecord: jest.fn(),
  buildCaptureReviewAction: jest.fn((recordType: string, fields: Record<string, unknown>) => ({
    action: `record_${recordType}`,
    params: fields,
    reply: 'review',
    confidence: 'medium',
  })),
}));

jest.mock('./confirm', () => ({
  confirmExtraction: jest.fn(),
}));

jest.mock('./duplicates', () => ({
  findDuplicate: jest.fn(),
}));

jest.mock('@/lib/services/owner-settings-service', () => ({
  getTenantSettings: jest.fn(),
}));

const { extractAndPersistRecord } = jest.requireMock('./extract') as {
  extractAndPersistRecord: jest.Mock;
};
const { confirmExtraction } = jest.requireMock('./confirm') as {
  confirmExtraction: jest.Mock;
};
const { findDuplicate } = jest.requireMock('./duplicates') as {
  findDuplicate: jest.Mock;
};
const { getTenantSettings } = jest.requireMock('@/lib/services/owner-settings-service') as {
  getTenantSettings: jest.Mock;
};

function makeAdmin(job: Record<string, unknown>) {
  const download = jest.fn().mockResolvedValue({
    data: {
      arrayBuffer: async () => Buffer.from('file-bytes'),
    },
    error: null,
  });

  const listLimit = jest.fn().mockResolvedValue({ data: [job], error: null });
  const listOrder = jest.fn().mockReturnValue({ limit: listLimit });
  const listEq = jest.fn().mockReturnValue({ order: listOrder });

  const claimMaybeSingle = jest.fn().mockResolvedValue({ data: job, error: null });
  const claimSelect = jest.fn().mockReturnValue({ maybeSingle: claimMaybeSingle });
  const claimEqPending = jest.fn().mockReturnValue({ select: claimSelect });
  const claimEqId = jest.fn().mockReturnValue({ eq: claimEqPending });
  const jobsUpdate = jest.fn().mockReturnValue({ eq: claimEqId });

  const extractedUpdateEq = jest.fn().mockResolvedValue({ error: null });
  const extractedUpdate = jest.fn().mockReturnValue({ eq: extractedUpdateEq });

  const admin = {
    storage: {
      from: jest.fn(() => ({ download })),
    },
    from: jest.fn((table: string) => {
      if (table === 'extraction_jobs') {
        return {
          select: () => ({ eq: listEq }),
          update: jobsUpdate,
        };
      }
      if (table === 'extracted_records') {
        return {
          update: extractedUpdate,
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }),
  };

  return {
    admin,
    download,
    jobsUpdate,
    extractedUpdate,
  };
}

describe('processOnePendingCaptureJob', () => {
  const baseJob = {
    id: 'job-1',
    tenant_id: 'tenant-1',
    media_input_id: 'media-1',
    status: 'pending',
    media_inputs: {
      id: 'media-1',
      kind: 'receipt',
      storage_path: 'tenant-1/capture/test.jpg',
      mime: 'image/jpeg',
      file_hash: 'hash-1',
      metadata: {
        original_name: 'receipt.jpg',
        duplicate_probe: {
          amountCents: 5000,
          date: '2026-07-21',
          supplier: 'Acme',
          reference: 'INV-1',
        },
      },
      uploaded_by: 'user-1',
    },
  };

  beforeEach(() => {
    extractAndPersistRecord.mockReset();
    confirmExtraction.mockReset();
    findDuplicate.mockReset();
    getTenantSettings.mockReset();
  });

  it('processes a pending job into review when auto-confirm is off', async () => {
    const { admin, download } = makeAdmin(baseJob);
    findDuplicate.mockResolvedValue(null);
    getTenantSettings.mockResolvedValue({ settings: { auto_confirm: false } });
    extractAndPersistRecord.mockResolvedValue({
      extractedRecordId: 'record-1',
      recordType: 'expense',
      fields: { amount_cents: 5000, expense_date: '2026-07-21' },
      lowConfidenceFields: [],
      proposedAction: { action: 'record_expense', params: { amount_cents: 5000 }, reply: 'ok', confidence: 'high' },
    });

    const result = await processOnePendingCaptureJob(admin as never);

    expect(download).toHaveBeenCalledWith('tenant-1/capture/test.jpg');
    expect(findDuplicate).toHaveBeenCalledWith(admin, 'tenant-1', 'hash-1', expect.objectContaining({
      amountCents: 5000,
      supplier: 'Acme',
    }));
    expect(extractAndPersistRecord).toHaveBeenCalledWith(
      admin,
      expect.any(Object),
      expect.objectContaining({
        tenantId: 'tenant-1',
        jobId: 'job-1',
        kind: 'receipt',
      }),
    );
    expect(confirmExtraction).not.toHaveBeenCalled();
    expect(result).toEqual({ jobId: 'job-1', status: 'review_required' });
  });

  it('auto-confirms when the tenant has trusted automation enabled and extraction is clean', async () => {
    const { admin } = makeAdmin(baseJob);
    findDuplicate.mockResolvedValue(null);
    getTenantSettings.mockResolvedValue({ settings: { auto_confirm: true } });
    extractAndPersistRecord.mockResolvedValue({
      extractedRecordId: 'record-2',
      recordType: 'expense',
      fields: { amount_cents: 5000, expense_date: '2026-07-21' },
      lowConfidenceFields: [],
      proposedAction: { action: 'record_expense', params: { amount_cents: 5000 }, reply: 'ok', confidence: 'high' },
    });
    confirmExtraction.mockResolvedValue({ linkedRecordType: 'expense', linkedRecordId: 'expense-1' });

    const result = await processOnePendingCaptureJob(admin as never);

    expect(confirmExtraction).toHaveBeenCalledWith(
      admin,
      'record-2',
      'user-1',
      expect.arrayContaining(['RECORD_EXPENSES']),
    );
    expect(result).toEqual({ jobId: 'job-1', status: 'confirmed' });
  });

  it('flags duplicate extracted records for manual review', async () => {
    const { admin, extractedUpdate } = makeAdmin(baseJob);
    findDuplicate.mockResolvedValue('expense-existing');
    getTenantSettings.mockResolvedValue({ settings: { auto_confirm: true } });
    extractAndPersistRecord.mockResolvedValue({
      extractedRecordId: 'record-3',
      recordType: 'expense',
      fields: { amount_cents: 5000, expense_date: '2026-07-21' },
      lowConfidenceFields: [],
      proposedAction: { action: 'record_expense', params: { amount_cents: 5000 }, reply: 'ok', confidence: 'high' },
    });

    const result = await processOnePendingCaptureJob(admin as never);

    expect(extractedUpdate).toHaveBeenCalledWith(expect.objectContaining({
      fields: expect.objectContaining({
        duplicate_match_id: 'expense-existing',
      }),
    }));
    expect(confirmExtraction).not.toHaveBeenCalled();
    expect(result).toEqual({ jobId: 'job-1', status: 'review_required' });
  });
});

