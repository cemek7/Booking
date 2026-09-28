import {
  resolveWhatsAppRoute,
  type RouteSessionStore,
} from '@/lib/whatsapp/v2/routeSession';

const NOW = new Date('2026-09-28T12:00:00.000Z');

function store(overrides: Partial<RouteSessionStore> = {}): RouteSessionStore {
  return {
    findEnabledTenantByRoutingCode: jest.fn().mockResolvedValue(null),
    findActiveSession: jest.fn().mockResolvedValue(null),
    upsertSession: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('resolveWhatsAppRoute', () => {
  it('lets an explicit valid code replace a stale shared-gateway session', async () => {
    const routeStore = store({
      findEnabledTenantByRoutingCode: jest.fn().mockResolvedValue('tenant-b'),
      findActiveSession: jest.fn().mockResolvedValue({ tenantId: 'tenant-a', expiresAt: '2026-09-29T12:00:00.000Z' }),
    });

    const result = await resolveWhatsAppRoute({
      externalId: '+2348000000001',
      gatewayPhoneNumberId: 'gateway-1',
      messageText: 'BETY42 I need braids',
      now: NOW,
    }, routeStore);

    expect(result).toEqual({
      status: 'routed',
      tenantId: 'tenant-b',
      source: 'routing_code',
      strippedMessage: 'I need braids',
    });
    expect(routeStore.upsertSession).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-b',
      expiresAt: '2026-09-29T12:00:00.000Z',
    }));
    expect(routeStore.findActiveSession).not.toHaveBeenCalled();
  });

  it('routes a dedicated number without consulting a shared session', async () => {
    const routeStore = store();
    const result = await resolveWhatsAppRoute({
      externalId: '+2348000000001',
      gatewayPhoneNumberId: 'dedicated-1',
      dedicatedTenantId: 'tenant-dedicated',
      messageText: 'hello',
      now: NOW,
    }, routeStore);

    expect(result).toEqual({
      status: 'routed', tenantId: 'tenant-dedicated', source: 'dedicated_number', strippedMessage: 'hello',
    });
    expect(routeStore.findActiveSession).not.toHaveBeenCalled();
  });

  it('uses an unexpired session only for the exact gateway and sender', async () => {
    const routeStore = store({
      findActiveSession: jest.fn().mockResolvedValue({ tenantId: 'tenant-a', expiresAt: '2026-09-28T12:05:00.000Z' }),
    });
    const result = await resolveWhatsAppRoute({
      externalId: '+2348000000001', gatewayPhoneNumberId: 'gateway-1', messageText: 'tomorrow works', now: NOW,
    }, routeStore);

    expect(result).toEqual({
      status: 'routed', tenantId: 'tenant-a', source: 'session', strippedMessage: 'tomorrow works',
    });
    expect(routeStore.findActiveSession).toHaveBeenCalledWith({
      channel: 'whatsapp', gatewayScope: 'gateway-1', externalId: '+2348000000001', now: NOW,
    });
  });

  it('asks for a code when there is no valid explicit, dedicated, or cached route', async () => {
    const routeStore = store();
    const result = await resolveWhatsAppRoute({
      externalId: '+2348000000001', gatewayPhoneNumberId: 'gateway-1', messageText: 'hello', now: NOW,
    }, routeStore);

    expect(result).toEqual({ status: 'needs_code', strippedMessage: 'hello' });
  });
});
