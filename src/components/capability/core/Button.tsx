'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost';
};

const VARIANT_CLASSES: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'sc-primary hover:opacity-90',
  secondary: 'sc-surface border border-current/20 hover:opacity-90',
  ghost: 'bg-transparent underline underline-offset-4 hover:opacity-80',
};

/**
 * Themed, keyboard-operable button with a visible focus ring.
 * Disabled state is styled distinctly (used by LeadForm while submitting).
 */
export function Button({ children, variant = 'primary', className = '', disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-md px-5 py-2.5 text-sm font-medium transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${className}`.trim()}
      {...rest}
    >
      {children}
    </button>
  );
}
