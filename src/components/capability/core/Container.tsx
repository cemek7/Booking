import type { ReactNode } from 'react';

export type ContainerProps = {
  children: ReactNode;
  className?: string;
  /** Constrains the maximum width; 'wide' for hero/content-heavy sections. */
  width?: 'default' | 'wide' | 'narrow';
};

const WIDTH_CLASSES: Record<NonNullable<ContainerProps['width']>, string> = {
  narrow: 'max-w-2xl',
  default: 'max-w-5xl',
  wide: 'max-w-6xl',
};

/** Horizontally-centered content wrapper with responsive gutters. */
export function Container({ children, className = '', width = 'default' }: ContainerProps) {
  return (
    <div className={`mx-auto w-full px-6 ${WIDTH_CLASSES[width]} ${className}`.trim()}>
      {children}
    </div>
  );
}
