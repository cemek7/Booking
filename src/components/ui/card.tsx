import { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import GlassCard from '@/components/ui/GlassCard';

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <GlassCard className={cn('p-4', className)}>{children}</GlassCard>;
}

export function CardHeader({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('px-6 py-4 border-b border-gray-100', className)}>{children}</div>;
}

export function CardTitle({ className, children }: { className?: string; children: ReactNode }) {
  return <h3 className={cn('text-lg font-semibold text-gray-900', className)}>{children}</h3>;
}

export function CardContent({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('px-6 py-4', className)}>{children}</div>;
}

export function CardDescription({ className, children }: { className?: string; children: ReactNode }) {
  return <p className={cn('text-sm text-gray-500', className)}>{children}</p>;
}

export function CardFooter({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('px-6 py-4 border-t border-gray-100 flex items-center', className)}>{children}</div>;
}

export default Card;
