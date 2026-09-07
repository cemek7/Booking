// @ts-nocheck
// Test: StaffInvitePage renders correctly
import React from 'react';
import { render, screen } from '@testing-library/react';

// Mock server-side requireAuth
jest.mock('@/lib/auth/server-auth', () => ({
  requireAuth: jest.fn().mockResolvedValue({ id: 'u1', email: 'manager@example.com', role: 'manager', tenantId: 't1' }),
}));

// Dynamic import workaround for async server components
let StaffInvitePage: (...args: never[]) => unknown;

describe('StaffInvitePage', () => {
  beforeAll(async () => {
    const mod = await import('@/app/dashboard/staff/invite/page');
    StaffInvitePage = mod.default;
  });

  it('renders invite page heading', async () => {
    const element = await StaffInvitePage();
    render(element);
    expect(screen.getByText('Invite Staff Member')).toBeTruthy();
  });
});
