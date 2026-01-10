import { ComponentPropsWithoutRef, ReactNode } from 'react';
import cn from 'classnames';

export default function GlassCard({
  className,
  children,
  ...props
}: {
  className?: string;
  children?: ReactNode;
} & ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      {...props}
      className={cn(
        // glass-like visual: subtle translucent background, backdrop blur, soft border and rounded corners
        'bg-white/5 backdrop-blur-sm border border-white/6 rounded-lg shadow-sm',
        className
      )}
    >
      {children}
    </div>
  );
}
