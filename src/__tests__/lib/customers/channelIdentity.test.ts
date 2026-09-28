import {
  ensureCustomerChannelIdentity,
  type ChannelIdentityStore,
} from '@/lib/customers/channelIdentity';

type Identity = {
  id: string;
  tenantId: string;
  customerId: string;
  channel: 'whatsapp' | 'instagram';
  externalId: string;
};

function memoryStore(): ChannelIdentityStore & { identities: Identity[]; customers: Array<Record<string, unknown>> } {
  const identities: Identity[] = [];
  const customers: Array<Record<string, unknown>> = [];
  let customerSequence = 0;
  let identitySequence = 0;

  return {
    identities,
    customers,
    async findIdentity(tenantId, channel, externalId) {
      return identities.find((row) =>
        row.tenantId === tenantId && row.channel === channel && row.externalId === externalId
      ) ?? null;
    },
    async findCustomerByNormalizedPhone(tenantId, normalizedPhone) {
      const row = customers.find((customer) =>
        customer.tenantId === tenantId && customer.normalizedPhone === normalizedPhone
      );
      return row ? String(row.id) : null;
    },
    async createCustomer(input) {
      const id = `customer-${++customerSequence}`;
      customers.push({ id, ...input });
      return id;
    },
    async createIdentity(input) {
      if (identities.some((row) =>
        row.tenantId === input.tenantId && row.channel === input.channel && row.externalId === input.externalId
      )) {
        throw Object.assign(new Error('duplicate identity'), { code: '23505' });
      }
      const row = { id: `identity-${++identitySequence}`, ...input };
      identities.push(row);
      return row;
    },
    async deleteUnreferencedCustomer(customerId) {
      const index = customers.findIndex((row) => row.id === customerId);
      if (index >= 0 && !identities.some((identity) => identity.customerId === customerId)) {
        customers.splice(index, 1);
      }
    },
  };
}

describe('ensureCustomerChannelIdentity', () => {
  it('keeps the same WhatsApp number isolated between tenants', async () => {
    const store = memoryStore();

    const tenantA = await ensureCustomerChannelIdentity({
      tenantId: 'tenant-a', channel: 'whatsapp', externalId: '0803 123 4567',
    }, store);
    const tenantB = await ensureCustomerChannelIdentity({
      tenantId: 'tenant-b', channel: 'whatsapp', externalId: '+2348031234567',
    }, store);

    expect(tenantA.customerId).not.toBe(tenantB.customerId);
    expect(store.identities).toEqual(expect.arrayContaining([
      expect.objectContaining({ tenantId: 'tenant-a', externalId: '+2348031234567' }),
      expect.objectContaining({ tenantId: 'tenant-b', externalId: '+2348031234567' }),
    ]));
  });

  it('reuses the same identity and customer for repeat inbound traffic', async () => {
    const store = memoryStore();
    const first = await ensureCustomerChannelIdentity({
      tenantId: 'tenant-a', channel: 'whatsapp', externalId: '08031234567',
    }, store);
    const repeat = await ensureCustomerChannelIdentity({
      tenantId: 'tenant-a', channel: 'whatsapp', externalId: '+234 803 123 4567',
    }, store);

    expect(first.created).toBe(true);
    expect(repeat).toEqual({ ...first, created: false });
    expect(store.customers).toHaveLength(1);
    expect(store.identities).toHaveLength(1);
  });

  it('keeps Instagram identities tenant-scoped and does not phone-normalize them', async () => {
    const store = memoryStore();
    const result = await ensureCustomerChannelIdentity({
      tenantId: 'tenant-a', channel: 'instagram', externalId: '17890001234567890', displayName: 'Ada',
    }, store);

    expect(result.customerId).toBe('customer-1');
    expect(store.identities[0]).toMatchObject({
      tenantId: 'tenant-a', channel: 'instagram', externalId: '17890001234567890',
    });
    expect(store.customers[0]).toMatchObject({ phone: null, normalizedPhone: null });
  });

  it('does not merge WhatsApp and Instagram without an explicit verified link', async () => {
    const store = memoryStore();
    const whatsapp = await ensureCustomerChannelIdentity({
      tenantId: 'tenant-a', channel: 'whatsapp', externalId: '+2348031234567', displayName: 'Ada',
    }, store);
    const instagram = await ensureCustomerChannelIdentity({
      tenantId: 'tenant-a', channel: 'instagram', externalId: '2348031234567', displayName: 'Ada',
    }, store);

    expect(instagram.customerId).not.toBe(whatsapp.customerId);
    expect(store.customers).toHaveLength(2);
  });

  it('reuses the winning identity and cleans up its orphan customer after a unique race', async () => {
    const findIdentity = jest
      .fn<ChannelIdentityStore['findIdentity']>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'identity-winner', tenantId: 'tenant-a', customerId: 'customer-winner',
        channel: 'instagram', externalId: 'IGSID_1',
      });
    const deleteUnreferencedCustomer = jest.fn().mockResolvedValue(undefined);
    const store: ChannelIdentityStore = {
      findIdentity,
      findCustomerByNormalizedPhone: jest.fn().mockResolvedValue(null),
      createCustomer: jest.fn().mockResolvedValue('customer-loser'),
      createIdentity: jest.fn().mockRejectedValue(Object.assign(new Error('duplicate'), { code: '23505' })),
      deleteUnreferencedCustomer,
    };

    await expect(ensureCustomerChannelIdentity({
      tenantId: 'tenant-a', channel: 'instagram', externalId: 'IGSID_1',
    }, store)).resolves.toEqual({
      identityId: 'identity-winner', customerId: 'customer-winner', created: false,
    });
    expect(deleteUnreferencedCustomer).toHaveBeenCalledWith('customer-loser', 'tenant-a');
  });

  it('reuses the customer that wins a concurrent WhatsApp customer insert', async () => {
    const findCustomer = jest
      .fn<ChannelIdentityStore['findCustomerByNormalizedPhone']>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('customer-winner');
    const store: ChannelIdentityStore = {
      findIdentity: jest.fn().mockResolvedValue(null),
      findCustomerByNormalizedPhone: findCustomer,
      createCustomer: jest.fn().mockRejectedValue(Object.assign(new Error('duplicate'), { code: '23505' })),
      createIdentity: jest.fn().mockResolvedValue({
        id: 'identity-winner', tenantId: 'tenant-a', customerId: 'customer-winner',
        channel: 'whatsapp', externalId: '+2348031234567',
      }),
      deleteUnreferencedCustomer: jest.fn().mockResolvedValue(undefined),
    };

    await expect(ensureCustomerChannelIdentity({
      tenantId: 'tenant-a', channel: 'whatsapp', externalId: '08031234567',
    }, store)).resolves.toEqual({
      identityId: 'identity-winner', customerId: 'customer-winner', created: true,
    });
  });
});
