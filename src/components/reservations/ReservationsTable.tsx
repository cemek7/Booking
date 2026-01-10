"use client";
import React, { useMemo, useState } from 'react';
import type { BookingEvent } from '../Calendar';

export interface ReservationsTableProps {
  reservations: BookingEvent[];
  columns?: Array<keyof BookingEvent | 'customer.name' | 'status' | 'serviceId' | 'staffId' | 'start' | 'end'>;
  selectable?: boolean;
  onRowClick?: (r: BookingEvent) => void;
  onBulkAction?: (action: string, ids: string[]) => Promise<void>;
}

export const ReservationsTable: React.FC<ReservationsTableProps> = ({ reservations, columns, selectable = true, onRowClick, onBulkAction }) => {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const allSelected = useMemo(() => reservations.length > 0 && reservations.every(r => selected[r.id]), [reservations, selected]);
  const colDefs = columns || ['customer.name', 'serviceId', 'staffId', 'status', 'start', 'end'];

  function toggleAll() {
    if (allSelected) {
      setSelected({});
    } else {
      const next: Record<string, boolean> = {};
      for (const r of reservations) next[r.id] = true;
      setSelected(next);
    }
  }

  function toggle(id: string) {
    setSelected(prev => ({ ...prev, [id]: !prev[id] }));
  }

  async function bulk(action: string) {
    if (!onBulkAction) return;
    const ids = Object.keys(selected).filter(k => selected[k]);
    if (ids.length === 0) return;
    await onBulkAction(action, ids);
    setSelected({});
  }

  return (
    <div className="w-full">
      {onBulkAction && (
        <div className="mb-2 flex items-center gap-2 text-xs">
          <button className="px-2 py-1 border rounded bg-gray-50" onClick={() => bulk('confirm')}>Confirm</button>
          <button className="px-2 py-1 border rounded bg-gray-50" onClick={() => bulk('cancel')}>Cancel</button>
          <button className="px-2 py-1 border rounded bg-gray-50" onClick={() => bulk('mark_paid')}>Mark Paid</button>
          <span className="text-gray-500 ml-2">{Object.values(selected).filter(Boolean).length} selected</span>
        </div>
      )}
      <table className="w-full text-sm border">
        <thead>
          <tr className="bg-gray-50">
            {selectable && (
              <th className="p-2 border w-8"><input type="checkbox" aria-label="select-all" checked={allSelected} onChange={toggleAll} /></th>
            )}
            {colDefs.map(col => (
              <th key={col as string} className="p-2 border text-left">{String(col)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {reservations.map(r => (
            <tr key={r.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => onRowClick?.(r)}>
              {selectable && (
                <td className="p-2 border w-8" onClick={e => e.stopPropagation()}>
                  <input type="checkbox" aria-label={`select-${r.id}`} checked={!!selected[r.id]} onChange={() => toggle(r.id)} />
                </td>
              )}
              {colDefs.map(col => {
                let value: any = '';
                switch (col) {
                  case 'customer.name':
                    value = r.customer?.name || r.customer?.id || ''; break;
                  case 'status':
                  case 'serviceId':
                  case 'staffId':
                  case 'start':
                  case 'end':
                    value = (r as any)[col]; break;
                  default:
                    value = (r as any)[col];
                }
                return <td key={String(col)} className="p-2 border">{String(value ?? '')}</td>;
              })}
            </tr>
          ))}
          {reservations.length === 0 && (
            <tr><td className="p-2 text-center text-gray-500" colSpan={(colDefs.length + (selectable ? 1 : 0))}>No reservations</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

export default ReservationsTable;
