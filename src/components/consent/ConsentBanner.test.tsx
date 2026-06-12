// src/components/consent/ConsentBanner.test.tsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach } from '@jest/globals';
import ConsentBanner from '@/components/consent/ConsentBanner';
import { getConsent } from '@/lib/consent/consentStore';

describe('ConsentBanner', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('shows the dialog when no decision has been made', () => {
    render(<ConsentBanner />);
    expect(screen.getByRole('dialog', { name: /cookie/i })).toBeInTheDocument();
  });

  it('records consent and hides on Accept all', () => {
    render(<ConsentBanner />);
    fireEvent.click(screen.getByRole('button', { name: /accept all/i }));
    expect(getConsent()?.analytics).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('records rejection and hides on Reject non-essential', () => {
    render(<ConsentBanner />);
    fireEvent.click(screen.getByRole('button', { name: /reject non-essential/i }));
    expect(getConsent()?.analytics).toBe(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('stays hidden when a decision already exists', () => {
    window.localStorage.setItem(
      'boka_consent_v1',
      JSON.stringify({ analytics: true, decidedAt: new Date().toISOString() }),
    );
    render(<ConsentBanner />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
