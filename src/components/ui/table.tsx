import { HTMLAttributes, ReactNode, TableHTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type TableProps = TableHTMLAttributes<HTMLTableElement> & { children: ReactNode };
type RowProps = HTMLAttributes<HTMLTableRowElement> & { children: ReactNode };
type CellProps = ThHTMLAttributes<HTMLTableCellElement> & { children: ReactNode };
type DataCellProps = TdHTMLAttributes<HTMLTableCellElement> & { children: ReactNode };

export function Table({ children, className, ...props }: TableProps) {
  return (
    <table
      className={cn('w-full min-w-max border-separate border-spacing-0 text-sm', className)}
      {...props}
    >
      {children}
    </table>
  );
}

export function THead({ children, className, ...props }: { children: ReactNode } & HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead className={cn('bg-slate-50/90 text-slate-500', className)} {...props}>
      {children}
    </thead>
  );
}

export function TBody({ children, className, ...props }: { children: ReactNode } & HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody className={className} {...props}>
      {children}
    </tbody>
  );
}

export function TR({ children, className, ...props }: RowProps) {
  return (
    <tr className={cn('transition-colors hover:bg-slate-50/70', className)} {...props}>
      {children}
    </tr>
  );
}

export function TH({ children, className, ...props }: CellProps) {
  return (
    <th
      className={cn(
        'border-b border-slate-200 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap',
        className
      )}
      {...props}
    >
      {children}
    </th>
  );
}

export function TD({ children, className, ...props }: DataCellProps) {
  return (
    <td
      className={cn('border-b border-slate-100 px-3 py-3 align-top text-sm text-slate-700 whitespace-nowrap', className)}
      {...props}
    >
      {children}
    </td>
  );
}

// shadcn-style aliases
export { THead as TableHeader, TBody as TableBody, TR as TableRow, TH as TableHead, TD as TableCell };
