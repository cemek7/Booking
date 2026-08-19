import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from '@jest/globals';
import LegalDocument from '@/components/legal/LegalDocument';

describe('LegalDocument', () => {
  it('renders the title, last-updated date, draft notice, and children', () => {
    render(
      <LegalDocument title="Privacy Policy" lastUpdated="2026-06-15">
        <p>Body content here.</p>
      </LegalDocument>,
    );
    expect(screen.getByRole('heading', { name: 'Privacy Policy', level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/Last updated: 2026-06-15/)).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(/pending legal review/i);
    expect(screen.getByText('Body content here.')).toBeInTheDocument();
  });
});
