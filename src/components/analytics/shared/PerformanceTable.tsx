'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowUpDown, ArrowUp, ArrowDown, Download } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface TableColumn<T> {
  key: keyof T | string;
  label: string;
  sortable?: boolean;
  formatValue?: (value: any, row: T) => React.ReactNode;
  align?: 'left' | 'center' | 'right';
  width?: string;
}

export interface PerformanceTableProps<T> {
  data: T[];
  columns: TableColumn<T>[];
  title?: string;
  description?: string;
  className?: string;
  onExport?: () => void;
  exportLabel?: string;
  emptyMessage?: string;
}

type SortDirection = 'asc' | 'desc' | null;

/**
 * PerformanceTable Component
 *
 * Sortable table for displaying staff/service performance data
 * Supports custom formatting, sorting, and CSV export
 *
 * @example
 * ```tsx
 * <PerformanceTable
 *   data={staffPerformance}
 *   columns={[
 *     { key: 'name', label: 'Staff Member', sortable: true },
 *     { key: 'bookings', label: 'Bookings', sortable: true, align: 'right' },
 *     { key: 'revenue', label: 'Revenue', formatValue: (v) => `$${v}`, align: 'right' }
 *   ]}
 *   title="Staff Performance"
 *   onExport={() => exportToCSV(staffPerformance)}
 * />
 * ```
 */
export default function PerformanceTable<T extends Record<string, any>>({
  data,
  columns,
  title,
  description,
  className,
  onExport,
  exportLabel = 'Export CSV',
  emptyMessage = 'No data available',
}: PerformanceTableProps<T>) {
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);

  const handleSort = (columnKey: string) => {
    if (sortColumn === columnKey) {
      // Toggle sort direction
      setSortDirection((prev) =>
        prev === 'asc' ? 'desc' : prev === 'desc' ? null : 'asc'
      );
      if (sortDirection === 'desc') {
        setSortColumn(null);
      }
    } else {
      setSortColumn(columnKey);
      setSortDirection('asc');
    }
  };

  // Sort data
  const sortedData = React.useMemo(() => {
    if (!sortColumn || !sortDirection) return data;

    return [...data].sort((a, b) => {
      const aValue = a[sortColumn];
      const bValue = b[sortColumn];

      if (aValue === bValue) return 0;

      const comparison =
        typeof aValue === 'string'
          ? aValue.localeCompare(bValue)
          : aValue > bValue
          ? 1
          : -1;

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [data, sortColumn, sortDirection]);

  const getSortIcon = (columnKey: string) => {
    if (sortColumn !== columnKey) return <ArrowUpDown className="h-4 w-4" />;
    return sortDirection === 'asc' ? (
      <ArrowUp className="h-4 w-4" />
    ) : (
      <ArrowDown className="h-4 w-4" />
    );
  };

  return (
    <Card className={className}>
      {(title || description || onExport) && (
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              {title && <CardTitle className="text-base font-semibold">{title}</CardTitle>}
              {description && (
                <p className="text-sm text-muted-foreground mt-1">{description}</p>
              )}
            </div>
            {onExport && (
              <Button variant="outline" size="sm" onClick={onExport}>
                <Download className="h-4 w-4 mr-2" />
                {exportLabel}
              </Button>
            )}
          </div>
        </CardHeader>
      )}
      <CardContent>
        <div className="relative overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                {columns.map((column) => (
                  <th
                    key={String(column.key)}
                    className={cn(
                      'py-3 px-4 font-medium text-muted-foreground',
                      column.align === 'center' && 'text-center',
                      column.align === 'right' && 'text-right',
                      column.sortable && 'cursor-pointer hover:text-foreground'
                    )}
                    style={{ width: column.width }}
                    onClick={() => column.sortable && handleSort(String(column.key))}
                  >
                    <div
                      className={cn(
                        'flex items-center gap-1',
                        column.align === 'center' && 'justify-center',
                        column.align === 'right' && 'justify-end'
                      )}
                    >
                      {column.label}
                      {column.sortable && getSortIcon(String(column.key))}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedData.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="py-8 px-4 text-center text-muted-foreground"
                  >
                    {emptyMessage}
                  </td>
                </tr>
              ) : (
                sortedData.map((row, rowIndex) => (
                  <tr
                    key={rowIndex}
                    className="border-b last:border-0 hover:bg-muted/50 transition-colors"
                  >
                    {columns.map((column) => {
                      const value = row[column.key as keyof T];
                      const displayValue = column.formatValue
                        ? column.formatValue(value, row)
                        : value;

                      return (
                        <td
                          key={String(column.key)}
                          className={cn(
                            'py-3 px-4',
                            column.align === 'center' && 'text-center',
                            column.align === 'right' && 'text-right'
                          )}
                        >
                          {displayValue}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
