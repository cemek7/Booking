import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';

const mockRecordBusinessEvent = jest.fn();
const mockValidateAction = jest.fn();
const mockExecuteAction = jest.fn();

jest.mock('@/lib/audit/businessEvents', () => ({
  BUSINESS_EVENT_ACTIONS: {
    APPROVAL_REQUESTED: 'approval.requested',
    APPROVAL_APPROVED: 'approval.approved',
    APPROVAL_REJECTED: 'approval.rejected',
  },
  recordBusinessEvent: (...args: unknown[]) => mockRecordBusinessEvent(...args),
}));

jest.mock('@/lib/booking/action-validator', () => ({
  validateAction: (...args: unknown[]) => mockValidateAction(...args),
  executeAction: (...args: unknown[]) => mockExecuteAction(...args),
}));

import { createApprovalRequest, decideApproval, gateApprovalForAction } from './requests';

function makeAdmin(options?: { request?: Record<string, unknown> | null }) {
  const request = options?.request ?? {
    id: 'request-1',
    tenant_id: 'tenant-1',
    request_type: 'discount',
    status: 'pending',
    requested_by: 'requester-1',
    action_payload: { action: 'refund_sale', params: { order_id: 'order-1' }, reply: 'ok', confidence: 'high' },
    required_permission: 'APPROVE_REFUNDS',
    expires_at: null,
  };

  const updates: Array<{ table: string; payload: Record<string, unknown> }> = [];
  const inserts: Array<{ table: string; payload: Record<string, unknown> }> = [];

  return {
    __updates: updates,
    __inserts: inserts,
    from: jest.fn((table: string) => {
      if (table === 'approval_requests') {
        return {
          insert: (payload: Record<string, unknown>) => {
            inserts.push({ table, payload });
            return {
              select: () => ({
                single: async () => ({
                  data: { id: 'request-2', ...payload },
                  error: null,
                }),
              }),
            };
          },
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: request, error: null }),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            updates.push({ table, payload });
            return {
              eq: () => ({
                eq: () => ({
                  select: () => ({
                    single: async () => ({
                      data: { ...request, ...payload },
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          },
        };
      }

      if (table === 'approval_actions') {
        return {
          insert: async (payload: Record<string, unknown>) => {
            inserts.push({ table, payload });
            return { error: null };
          },
        };
      }

      throw new Error(`Unexpected table ${table}`);
    }),
  } as unknown as SupabaseClient & {
    __updates: Array<{ table: string; payload: Record<string, unknown> }>;
    __inserts: Array<{ table: string; payload: Record<string, unknown> }>;
  };
}

describe('approval requests', () => {
  beforeEach(() => {
    mockRecordBusinessEvent.mockReset();
    mockValidateAction.mockReset();
    mockExecuteAction.mockReset();
  });

  it('creates a pending approval request and emits approval.requested', async () => {
    const admin = makeAdmin({ request: null });
    const request = await createApprovalRequest(admin, {
      tenantId: 'tenant-1',
      requestType: 'discount',
      requestedBy: 'user-1',
      amount: 5000,
      percent: 20,
      reason: 'VIP retention',
      actionPayload: { action: 'refund_sale', params: { order_id: 'order-1' }, reply: 'ok', confidence: 'high' },
      requiredPermission: 'APPROVE_LARGE_DISCOUNTS',
    });

    expect(request).toEqual(expect.objectContaining({ id: 'request-2', request_type: 'discount' }));
    expect(mockRecordBusinessEvent).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({ action: 'approval.requested', entityType: 'approval_request' })
    );
  });

  it('rejects self-approval and missing permission', async () => {
    const admin = makeAdmin();

    await expect(
      decideApproval(admin, {
        requestId: 'request-1',
        actorId: 'requester-1',
        actorPerms: ['APPROVE_REFUNDS'],
        decision: 'approve',
      })
    ).rejects.toThrow('Approver cannot approve their own request');

    await expect(
      decideApproval(admin, {
        requestId: 'request-1',
        actorId: 'manager-1',
        actorPerms: ['VIEW_REVENUE'],
        decision: 'approve',
      })
    ).rejects.toThrow('Approver lacks required permission');
  });

  it('re-validates and executes on approval', async () => {
    const admin = makeAdmin();
    mockValidateAction.mockResolvedValue({ valid: true });
    mockExecuteAction.mockResolvedValue({ success: true, reply: 'done' });

    const approved = await decideApproval(admin, {
      requestId: 'request-1',
      actorId: 'manager-1',
      actorPerms: ['APPROVE_REFUNDS'],
      decision: 'approve',
      note: 'Reviewed',
    });

    expect(mockValidateAction).toHaveBeenCalledWith('tenant-1', expect.objectContaining({ action: 'refund_sale' }));
    expect(mockExecuteAction).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ action: 'refund_sale' }),
      expect.objectContaining({ actorId: 'manager-1', userRole: 'owner', channel: 'dashboard' })
    );
    expect(approved).toEqual(expect.objectContaining({ status: 'approved' }));
  });

  it('routes over-limit discount actions into pending approval requests', async () => {
    const admin = makeAdmin({ request: null });
    admin.from = jest.fn((table: string) => {
      if (table === 'tenant_approval_policies') {
        return {
          select: () => ({
            eq: async () => ({
              data: [],
              error: null,
            }),
          }),
        };
      }
      if (table === 'approval_requests') {
        return {
          insert: (payload: Record<string, unknown>) => {
            admin.__inserts.push({ table, payload });
            return {
              select: () => ({
                single: async () => ({ data: { id: 'request-99', ...payload }, error: null }),
              }),
            };
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }) as never;

    const result = await gateApprovalForAction(admin, {
      tenantId: 'tenant-1',
      actorId: 'staff-1',
      actorRole: 'staff',
      aiResponse: {
        action: 'create_order',
        params: {
          items: [{ product_id: 'product-1', quantity: 1, unit_price_cents: 10000 }],
          discount_cents: 2000,
          reason: 'VIP retention',
        },
        reply: 'Apply discount',
        confidence: 'high',
      },
    });

    expect(result).toEqual({
      status: 'pending',
      requestId: 'request-99',
      reply: 'Discount request sent for approval (20%).',
    });
  });

  it('allows small discounts to execute directly and requires reasons for refunds', async () => {
    const admin = makeAdmin({ request: null });
    admin.from = jest.fn((table: string) => {
      if (table === 'tenant_approval_policies') {
        return {
          select: () => ({
            eq: async () => ({
              data: [],
              error: null,
            }),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }) as never;

    await expect(
      gateApprovalForAction(admin, {
        tenantId: 'tenant-1',
        actorId: 'staff-1',
        actorRole: 'staff',
        aiResponse: {
          action: 'refund_sale',
          params: { order_id: 'order-1' },
          reply: 'Refund',
          confidence: 'high',
        },
      })
    ).rejects.toThrow('Refunds require a reason');

    const result = await gateApprovalForAction(admin, {
      tenantId: 'tenant-1',
      actorId: 'staff-1',
      actorRole: 'staff',
      aiResponse: {
        action: 'create_order',
        params: {
          items: [{ product_id: 'product-1', quantity: 1, unit_price_cents: 10000 }],
          discount_cents: 300,
        },
        reply: 'Apply discount',
        confidence: 'high',
      },
    });

    expect(result).toEqual({ status: 'clear' });
  });
});
