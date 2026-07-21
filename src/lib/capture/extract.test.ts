import { extractAndPersistRecord, verifyCaptureDependencies } from './extract';

jest.mock('@/lib/voice/sttService', () => ({
  transcribeAudio: jest.fn(),
}));

const { transcribeAudio } = jest.requireMock('@/lib/voice/sttService') as {
  transcribeAudio: jest.Mock;
};

describe('verifyCaptureDependencies', () => {
  it('reports the grounded transcription and vision providers', () => {
    expect(verifyCaptureDependencies()).toEqual({
      transcription: {
        module: 'src/lib/voice/sttService.ts',
        providers: ['openai: whisper-1', 'local: whisper.cpp sidecar'],
        defaultProvider: 'openai',
      },
      vision: {
        modules: ['src/lib/openrouter.ts', 'src/lib/google-ai.ts'],
        notes: expect.any(String),
      },
    });
  });
});

describe('extractAndPersistRecord', () => {
  beforeEach(() => {
    transcribeAudio.mockReset();
  });

  it('routes voice capture through STT, persists confidence, and flags low-confidence fields', async () => {
    transcribeAudio.mockResolvedValue({ text: 'Expense receipt from Acme for ₦18,000 on 2026-07-21' });

    const extractedSingle = jest.fn().mockResolvedValue({ data: { id: 'record-1' }, error: null });
    const extractedSelect = jest.fn().mockReturnValue({ single: extractedSingle });
    const extractedInsert = jest.fn().mockReturnValue({ select: extractedSelect });
    const extractionEqId = jest.fn().mockResolvedValue({ error: null });
    const extractionEqTenant = jest.fn().mockReturnValue({ eq: extractionEqId });
    const extractionUpdate = jest.fn().mockReturnValue({ eq: extractionEqTenant });

    const admin = {
      from: jest.fn((table: string) => {
        if (table === 'extracted_records') return { insert: extractedInsert };
        if (table === 'extraction_jobs') return { update: extractionUpdate };
        throw new Error(`Unexpected table ${table}`);
      }),
    } as unknown as Parameters<typeof extractAndPersistRecord>[0];

    const provider = {
      extract: jest.fn().mockResolvedValue({
        recordType: 'expense',
        fields: {
          supplier_name: 'Acme',
          amount: '₦18,000',
          expense_date: '2026-07-21T12:00:00.000Z',
          reference: 'EXP-1',
        },
        fieldConfidence: {
          supplier_name: 0.92,
          amount: 0.95,
          expense_date: 0.52,
        },
        model: 'openrouter/gpt-4.1-mini',
        promptVersion: 'capture-v1',
      }),
    };

    const result = await extractAndPersistRecord(admin, provider, {
      kind: 'voice',
      mime: 'audio/ogg',
      buffer: Buffer.from('audio'),
      tenantId: 'tenant-1',
      jobId: 'job-1',
    });

    expect(transcribeAudio).toHaveBeenCalledWith(expect.any(Buffer), 'openai');
    expect(provider.extract).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'voice',
      text: 'Expense receipt from Acme for ₦18,000 on 2026-07-21',
    }));
    expect(extractedInsert).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: 'tenant-1',
      job_id: 'job-1',
      record_type: 'expense',
      fields: expect.objectContaining({
        supplier_name: 'Acme',
        amount_cents: 1_800_000,
        expense_date: '2026-07-21',
      }),
      low_confidence_fields: ['expense_date'],
      proposed_action: expect.objectContaining({
        action: 'owner_query',
      }),
    }));
    expect(extractionUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'review_required',
      model: 'openrouter/gpt-4.1-mini',
      prompt_version: 'capture-v1',
    }));
    expect(result).toEqual(expect.objectContaining({
      extractedRecordId: 'record-1',
      recordType: 'expense',
      lowConfidenceFields: ['expense_date'],
      transcriptionText: 'Expense receipt from Acme for ₦18,000 on 2026-07-21',
    }));
  });

  it('produces an executable stock-count proposal for stock sheets', async () => {
    const extractedSingle = jest.fn().mockResolvedValue({ data: { id: 'record-2' }, error: null });
    const extractedSelect = jest.fn().mockReturnValue({ single: extractedSingle });
    const extractedInsert = jest.fn().mockReturnValue({ select: extractedSelect });
    const extractionEqId = jest.fn().mockResolvedValue({ error: null });
    const extractionEqTenant = jest.fn().mockReturnValue({ eq: extractionEqId });
    const extractionUpdate = jest.fn().mockReturnValue({ eq: extractionEqTenant });

    const admin = {
      from: jest.fn((table: string) => {
        if (table === 'extracted_records') return { insert: extractedInsert };
        if (table === 'extraction_jobs') return { update: extractionUpdate };
        throw new Error(`Unexpected table ${table}`);
      }),
    } as unknown as Parameters<typeof extractAndPersistRecord>[0];

    const provider = {
      extract: jest.fn().mockResolvedValue({
        recordType: 'stock_count',
        fields: {
          items: [
            { product_name: 'Relaxer', counted_units: 5 },
            { product_name: 'Shampoo', counted_units: 2 },
          ],
        },
        fieldConfidence: {
          items: 0.91,
        },
        model: 'gemini-2.0-flash',
        promptVersion: 'capture-v1',
      }),
    };

    const result = await extractAndPersistRecord(admin, provider, {
      kind: 'stock_sheet',
      mime: 'image/jpeg',
      buffer: Buffer.from('image'),
      tenantId: 'tenant-2',
      jobId: 'job-2',
      textContent: 'Relaxer 5, Shampoo 2',
    });

    expect(result.proposedAction).toEqual(expect.objectContaining({
      action: 'adjust_stock',
      params: expect.objectContaining({
        source: 'multimodal_capture',
        items: expect.any(Array),
      }),
    }));
    expect(result.lowConfidenceFields).toEqual([]);
  });
});
