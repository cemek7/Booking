import React from 'react';
import { render, screen } from '@testing-library/react';
import TenantSettings from '@/components/TenantSettings';

describe('TenantSettings', () => {
  it('renders without crashing', () => {
    render(<TenantSettings tenantId="test-tenant" />);
    expect(screen.getByText(/Tenant Settings/i)).toBeInTheDocument();
  });
});
