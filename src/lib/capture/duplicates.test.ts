import { findDuplicate } from './duplicates';

describe('findDuplicate', () => {
  it('returns an exact media-input hash match first', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({ data: { id: 'media-1' }, error: null });
    const eqHash = jest.fn().mockReturnValue({ maybeSingle });
    const eqTenant = jest.fn().mockReturnValue({ eq: eqHash });

    const admin = {
      from: jest.fn((table: string) => {
        if (table === 'media_inputs') return { select: () => ({ eq: eqTenant }) };
        throw new Error(`Unexpected table ${table}`);
      }),
    } as unknown as Parameters<typeof findDuplicate>[0];

    const result = await findDuplicate(admin, 'tenant-1', 'hash-1', {
      amountCents: 50_000,
      date: '2026-07-20',
      supplier: 'Acme',
      reference: 'INV-1',
    });

    expect(result).toBe('media-1');
  });

  it('returns a fuzzy match when amount, date, supplier and reference align', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
    const eqHash = jest.fn().mockReturnValue({ maybeSingle });
    const eqTenant = jest.fn().mockReturnValue({ eq: eqHash });

    const records = [
      {
        id: 'record-1',
        linked_record_id: 'expense-1',
        fields: {
          amount_cents: 125000,
          expense_date: '2026-07-18',
          supplier_name: 'Acme Supplies',
          reference: 'RCPT-44',
        },
      },
    ];
    const recordIn = jest.fn().mockResolvedValue({ data: records, error: null });
    const recordEq = jest.fn().mockReturnValue({ in: recordIn });

    const admin = {
      from: jest.fn((table: string) => {
        if (table === 'media_inputs') return { select: () => ({ eq: eqTenant }) };
        if (table === 'extracted_records') return { select: () => ({ eq: recordEq }) };
        throw new Error(`Unexpected table ${table}`);
      }),
    } as unknown as Parameters<typeof findDuplicate>[0];

    const result = await findDuplicate(admin, 'tenant-1', 'new-hash', {
      amountCents: 125000,
      date: '2026-07-18T10:00:00.000Z',
      supplier: 'acme supplies',
      reference: 'rcpt-44',
    });

    expect(result).toBe('expense-1');
  });

  it('returns null when there is no exact or fuzzy match', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
    const eqHash = jest.fn().mockReturnValue({ maybeSingle });
    const eqTenant = jest.fn().mockReturnValue({ eq: eqHash });

    const recordIn = jest.fn().mockResolvedValue({
      data: [
        {
          id: 'record-2',
          linked_record_id: null,
          fields: {
            amount_cents: 999,
            expense_date: '2026-07-01',
            supplier_name: 'Different Supplier',
            reference: 'OTHER',
          },
        },
      ],
      error: null,
    });
    const recordEq = jest.fn().mockReturnValue({ in: recordIn });

    const admin = {
      from: jest.fn((table: string) => {
        if (table === 'media_inputs') return { select: () => ({ eq: eqTenant }) };
        if (table === 'extracted_records') return { select: () => ({ eq: recordEq }) };
        throw new Error(`Unexpected table ${table}`);
      }),
    } as unknown as Parameters<typeof findDuplicate>[0];

    const result = await findDuplicate(admin, 'tenant-1', 'new-hash', {
      amountCents: 50000,
      date: '2026-07-20',
      supplier: 'Acme',
      reference: 'INV-9',
    });

    expect(result).toBeNull();
  });
});
