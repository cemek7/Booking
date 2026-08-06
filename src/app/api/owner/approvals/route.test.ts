import { describe, expect, it, jest } from '@jest/globals';

const mockListApprovalRequests = jest.fn();
const mockListApprovalPolicies = jest.fn();
const mockUpsertApprovalPolicy = jest.fn();

jest.mock('@/lib/approvals/requests', () => ({
  listApprovalRequests: (...args: unknown[]) => mockListApprovalRequests(...args),
  listApprovalPolicies: (...args: unknown[]) => mockListApprovalPolicies(...args),
  upsertApprovalPolicy: (...args: unknown[]) => mockUpsertApprovalPolicy(...args),
}));

import { GET, POST } from './route';

describe('/api/owner/approvals', () => {
  it('lists approval requests and policies', async () => {
    mockListApprovalRequests.mockResolvedValueOnce([{ id: 'approval-1' }]);
    mockListApprovalPolicies.mockResolvedValueOnce([{ role: 'staff' }]);

    const response = await GET({
      request: new Request('http://localhost/api/owner/approvals?status=pending'),
      supabase: {} as never,
      user: { id: 'user-1', email: 'owner@test.com', role: 'owner', tenantId: 'tenant-1', permissions: [] },
    });

    expect(response).toEqual({
      requests: [{ id: 'approval-1' }],
      policies: [{ role: 'staff' }],
    });
  });

  it('upserts approval policy rows', async () => {
    mockUpsertApprovalPolicy.mockResolvedValueOnce([{ role: 'staff', request_type: 'discount' }]);

    const response = await POST({
      request: {
        method: 'POST',
        url: 'http://localhost/api/owner/approvals',
        headers: { get: () => null },
        json: async () => ({
          request_type: 'discount',
          role: 'staff',
          max_self_approve: 5,
          requires_permission: 'APPROVE_LARGE_DISCOUNTS',
        }),
      } as never,
      supabase: {} as never,
      user: { id: 'user-1', email: 'owner@test.com', role: 'owner', tenantId: 'tenant-1', permissions: [] },
    });

    expect(response).toEqual({ policies: [{ role: 'staff', request_type: 'discount' }] });
  });
});
