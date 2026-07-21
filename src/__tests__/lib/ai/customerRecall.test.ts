import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { getCustomerRecall } from '@/lib/ai/customerRecall';

type Resp = { data: unknown; error: unknown };

const responses: Resp[] = [];

function pushDb(data: unknown, error: unknown = null) {
  responses.push({ data, error });
}

function consume(): Resp {
  return responses.shift() ?? { data: null, error: null };
}

function makeChain(): any {
  const chain: any = {};
  ['select', 'eq', 'is', 'lt', 'not', 'order', 'limit'].forEach((method) => {
    chain[method] = () => chain;
  });
  chain.maybeSingle = async () => consume();
  chain.then = (resolve: any, reject: any) =>
    Promise.resolve().then(() => consume()).then(resolve, reject);
  return chain;
}

const admin: any = { from: jest.fn(() => makeChain()) };
const recent = new Date(Date.now() - 3 * 24 * 3600e3).toISOString();
const old = new Date(Date.now() - 60 * 24 * 3600e3).toISOString();

describe('getCustomerRecall', () => {
  beforeEach(() => {
    responses.length = 0;
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('returns null for an unknown customer', async () => {
    pushDb(null);

    await expect(getCustomerRecall(admin, 't1', '+2348012345678')).resolves.toBeNull();
  });

  it('returns null when the customer has no past visits', async () => {
    pushDb({ id: 'c1', last_visit: null });
    pushDb([]);

    await expect(getCustomerRecall(admin, 't1', '+2348012345678')).resolves.toBeNull();
  });

  it('returns lastService and a single-visit recall without usual staff', async () => {
    pushDb({ id: 'c1', last_visit: recent });
    pushDb([
      {
        start_at: recent,
        status: 'confirmed',
        service_id: 's1',
        tenant_staff_id: 'st1',
        services: { name: 'Trim', rebooking_interval_days: null },
      },
    ]);

    await expect(getCustomerRecall(admin, 't1', '+2348012345678')).resolves.toMatchObject({
      lastService: 'Trim',
      usualStaff: null,
      visitCount: 1,
      rebookingDue: false,
    });
  });

  it('returns usualStaff when one staff has at least two visits', async () => {
    pushDb({ id: 'c1', last_visit: recent });
    pushDb([
      {
        start_at: recent,
        status: 'confirmed',
        service_id: 's1',
        tenant_staff_id: 'st1',
        services: { name: 'Trim', rebooking_interval_days: null },
      },
      {
        start_at: old,
        status: 'completed',
        service_id: 's1',
        tenant_staff_id: 'st1',
        services: { name: 'Trim', rebooking_interval_days: null },
      },
    ]);
    pushDb({ name: 'Sarah' });

    await expect(getCustomerRecall(admin, 't1', '+2348012345678')).resolves.toMatchObject({
      usualStaff: 'Sarah',
      visitCount: 2,
    });
  });

  it('returns null usualStaff when the favorite staff row is gone', async () => {
    pushDb({ id: 'c1', last_visit: recent });
    pushDb([
      {
        start_at: recent,
        status: 'confirmed',
        service_id: 's1',
        tenant_staff_id: 'st1',
        services: { name: 'Trim', rebooking_interval_days: null },
      },
      {
        start_at: old,
        status: 'confirmed',
        service_id: 's1',
        tenant_staff_id: 'st1',
        services: { name: 'Trim', rebooking_interval_days: null },
      },
    ]);
    pushDb(null);

    await expect(getCustomerRecall(admin, 't1', '+2348012345678')).resolves.toMatchObject({
      usualStaff: null,
    });
  });

  it('returns rebookingDue when the last visit is older than the service interval', async () => {
    pushDb({ id: 'c1', last_visit: old });
    pushDb([
      {
        start_at: old,
        status: 'confirmed',
        service_id: 's1',
        tenant_staff_id: null,
        services: { name: 'Trim', rebooking_interval_days: 30 },
      },
    ]);

    await expect(getCustomerRecall(admin, 't1', '+2348012345678')).resolves.toMatchObject({
      rebookingDue: true,
    });
  });

  it('fails quiet and returns null on query error', async () => {
    const throwing: any = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => {
                throw new Error('db');
              },
            }),
          }),
        }),
      }),
    };

    await expect(getCustomerRecall(throwing, 't1', '+2348012345678')).resolves.toBeNull();
  });
});
