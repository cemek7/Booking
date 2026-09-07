import { describe, expect, it, jest } from '@jest/globals';

import { findCustomerByPhone, normalizePhone, resolveCustomer } from './identity';

describe('normalizePhone', () => {
  it('normalizes Nigerian local numbers to E.164', () => {
    expect(normalizePhone('08031234567')).toBe('+2348031234567');
  });

  it('normalizes already formatted Nigerian numbers', () => {
    expect(normalizePhone('+234 803 123 4567')).toBe('+2348031234567');
  });

  it('returns null for empty inputs', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });
});

function makeMaybeSingle(value: unknown) {
  return jest.fn().mockResolvedValue(value);
}

function makeAdmin(responses: Array<{ data: unknown; error: unknown }>) {
  let callIndex = 0;
  return {
    from: jest.fn(() => {
      const response = responses[Math.min(callIndex, responses.length - 1)];
      callIndex += 1;
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        maybeSingle: makeMaybeSingle(response),
        insert: jest.fn().mockReturnThis(),
      };
    }),
  };
}

describe('resolveCustomer', () => {
  it('finds an existing customer by normalized phone', async () => {
    const admin = makeAdmin([{ data: { id: 'cust-found', merged_into: null, name: 'Ada' }, error: null }]);
    await expect(findCustomerByPhone(admin as never, 'tenant-1', '08031234567')).resolves.toMatchObject({ id: 'cust-found' });
  });

  it('returns an existing customer matched by normalized_phone', async () => {
    const admin = makeAdmin([{ data: { id: 'cust-1', merged_into: null }, error: null }]);
    await expect(resolveCustomer(admin as never, 'tenant-1', '08031234567')).resolves.toBe('cust-1');
  });

  it('creates a new customer when no active customer exists', async () => {
    const admin = {
      from: jest
        .fn()
        .mockImplementationOnce(() => ({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          is: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
        }))
        .mockImplementationOnce(() => ({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          is: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
        }))
        .mockImplementationOnce(() => ({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          is: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
        }))
        .mockImplementationOnce(() => ({
          insert: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: { id: 'cust-new' }, error: null }),
        })),
    };

    await expect(
      resolveCustomer(admin as never, 'tenant-1', '08031234567', {
        name: 'Ada',
        email: 'ada@example.com',
        source: 'unit_test',
      }),
    ).resolves.toBe('cust-new');
  });

  it('never returns a merged-away customer because lookup filters merged_into null', async () => {
    const isSpy = jest.fn().mockReturnThis();
    const admin = {
      from: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: isSpy,
        maybeSingle: jest.fn().mockResolvedValue({ data: { id: 'cust-2', merged_into: null }, error: null }),
      })),
    };

    const id = await resolveCustomer(admin as never, 'tenant-1', '+2348031234567');
    expect(id).toBe('cust-2');
    expect(isSpy).toHaveBeenCalledWith('merged_into', null);
  });
});
