import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach } from '@jest/globals';
import userEvent from '@testing-library/user-event';
import CloseAccountSection from '@/components/settings/CloseAccountSection';

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true }),
  }) as jest.Mock;
});

afterEach(() => {
  jest.resetAllMocks();
});

describe('CloseAccountSection', () => {
  describe('active lifecycle state', () => {
    it('button is disabled until tenant name is typed correctly', async () => {
      render(
        <CloseAccountSection
          tenantId="ten_1"
          tenantName="Acme"
          lifecycleState="active"
        />
      );

      const button = screen.getByRole('button', { name: /close account/i });
      expect(button).toBeDisabled();

      const input = screen.getByLabelText(/type tenant name to confirm/i);

      await userEvent.type(input, 'Acm');
      expect(button).toBeDisabled();

      await userEvent.type(input, 'e');
      expect(button).not.toBeDisabled();
    });

    it('clicking submits POST to /offboard with confirmText in body', async () => {
      render(
        <CloseAccountSection
          tenantId="ten_1"
          tenantName="Acme"
          lifecycleState="active"
        />
      );

      const input = screen.getByLabelText(/type tenant name to confirm/i);
      await userEvent.type(input, 'Acme');

      const button = screen.getByRole('button', { name: /close account/i });
      await userEvent.click(button);

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/tenants/ten_1/offboard',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"confirmText":"Acme"'),
        })
      );
    });
  });

  describe('non-active lifecycle state', () => {
    it('shows reactivate banner with button that POSTs to /reactivate', async () => {
      render(
        <CloseAccountSection
          tenantId="ten_1"
          tenantName="Acme"
          lifecycleState="scheduled_for_deletion"
        />
      );

      expect(
        screen.getByText(/scheduled for deletion/i)
      ).toBeInTheDocument();

      const reactivateBtn = screen.getByRole('button', { name: /reactivate/i });
      expect(reactivateBtn).toBeInTheDocument();

      await userEvent.click(reactivateBtn);

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/tenants/ten_1/reactivate',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });
});
