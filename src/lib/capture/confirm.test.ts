import { confirmExtraction } from './confirm';

jest.mock('@/lib/booking/action-validator', () => ({
  validateAction: jest.fn(),
  executeAction: jest.fn(),
}));

jest.mock('@/lib/audit/businessEvents', () => ({
  BUSINESS_EVENT_ACTIONS: {
    CAPTURE_CONFIRMED: 'capture.confirmed',
  },
  recordBusinessEvent: jest.fn(),
}));

const { validateAction, executeAction } = jest.requireMock('@/lib/booking/action-validator') as {
  validateAction: jest.Mock;
  executeAction: jest.Mock;
};

const { recordBusinessEvent } = jest.requireMock('@/lib/audit/businessEvents') as {
  recordBusinessEvent: jest.Mock;
};

describe('confirmExtraction', () => {
  beforeEach(() => {
    validateAction.mockReset();
    executeAction.mockReset();
    recordBusinessEvent.mockReset();
  });

  it('validates, executes, links the created record, and marks the job confirmed', async () => {
    validateAction.mockResolvedValue({ valid: true });
    executeAction.mockResolvedValue({
      success: true,
      data: {
        expense: { id: 'expense-1' },
      },
    });

    const extractedUpdateEq = jest.fn().mockResolvedValue({ error: null });
    const extractedUpdate = jest.fn().mockReturnValue({ eq: extractedUpdateEq });
    const extractedSingle = jest.fn().mockResolvedValue({
      data: {
        id: 'record-1',
        tenant_id: 'tenant-1',
        job_id: 'job-1',
        record_type: 'expense',
        fields: {},
        proposed_action: {
          action: 'record_expense',
          params: { amount_cents: 5000, expense_date: '2026-07-21' },
          reply: 'ok',
          confidence: 'high',
        },
      },
      error: null,
    });
    const extractedEq = jest.fn().mockReturnValue({ single: extractedSingle });

    const jobUpdateEq = jest.fn().mockResolvedValue({ error: null });
    const jobUpdate = jest.fn().mockReturnValue({ eq: jobUpdateEq });

    const admin = {
      from: jest.fn((table: string) => {
        if (table === 'extracted_records') {
          return {
            select: () => ({ eq: extractedEq }),
            update: extractedUpdate,
          };
        }
        if (table === 'extraction_jobs') {
          return {
            update: jobUpdate,
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    } as unknown as Parameters<typeof confirmExtraction>[0];

    const result = await confirmExtraction(admin, 'record-1', 'user-1', ['RECORD_EXPENSES']);

    expect(validateAction).toHaveBeenCalledWith('tenant-1', expect.objectContaining({ action: 'record_expense' }));
    expect(executeAction).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ action: 'record_expense' }),
      expect.objectContaining({ actorId: 'user-1', permissions: ['RECORD_EXPENSES'] }),
    );
    expect(extractedUpdate).toHaveBeenCalledWith({
      linked_record_type: 'expense',
      linked_record_id: 'expense-1',
    });
    expect(jobUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed' }));
    expect(recordBusinessEvent).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        action: 'capture.confirmed',
        entityType: 'extracted_record',
        entityId: 'record-1',
      }),
    );
    expect(result).toEqual({ linkedRecordType: 'expense', linkedRecordId: 'expense-1' });
  });

  it('rejects duplicate-marked extracted records before execution', async () => {
    const extractedSingle = jest.fn().mockResolvedValue({
      data: {
        id: 'record-2',
        tenant_id: 'tenant-1',
        job_id: 'job-2',
        record_type: 'expense',
        fields: { duplicate_match_id: 'expense-existing' },
        proposed_action: {
          action: 'record_expense',
          params: { amount_cents: 5000, expense_date: '2026-07-21' },
          reply: 'ok',
          confidence: 'high',
        },
      },
      error: null,
    });
    const extractedEq = jest.fn().mockReturnValue({ single: extractedSingle });

    const admin = {
      from: jest.fn((table: string) => {
        if (table === 'extracted_records') {
          return {
            select: () => ({ eq: extractedEq }),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    } as unknown as Parameters<typeof confirmExtraction>[0];

    await expect(confirmExtraction(admin, 'record-2', 'user-1')).rejects.toThrow(
      'Duplicate capture must be reviewed manually before confirmation',
    );
    expect(validateAction).not.toHaveBeenCalled();
    expect(executeAction).not.toHaveBeenCalled();
  });
});
