"use client";
import React, { memo, useMemo, useState, useCallback } from 'react';
import type { BookingEvent } from '../Calendar';

type ColumnDef = keyof BookingEvent | 'customer.name' | 'status' | 'serviceId' | 'staffId' | 'start' | 'end';

interface ReservationRowProps {
  reservation: BookingEvent;
  colDefs: ColumnDef[];
  selectable: boolean;
  isSelected: boolean;
  onRowClick?: (r: BookingEvent) => void;
  onToggle: (id: string) => void;
}

const ReservationRow = memo<ReservationRowProps>(function ReservationRow({
  reservation,
  colDefs,
  selectable,
  isSelected,
  onRowClick,
  onToggle,
}) {
  const handleRowClick = useCallback(() => {
    onRowClick?.(reservation);
  }, [onRowClick, reservation]);

  const handleToggle = useCallback(() => {
    onToggle(reservation.id);
  }, [onToggle, reservation.id]);

  const handleCheckboxClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <tr className="hover:bg-gray-50 cursor-pointer" onClick={handleRowClick}>
      {selectable && (
        <td className="p-2 border w-8" onClick={handleCheckboxClick}>
          <input
            type="checkbox"
            aria-label={`select-${reservation.id}`}
            checked={isSelected}
            onChange={handleToggle}
          />
        </td>
      )}
      {colDefs.map(col => {
        let value: string | number | undefined = '';
        switch (col) {
          case 'customer.name':
            value = reservation.customer?.name || reservation.customer?.id || '';
            break;
          case 'status':
            value = reservation.status;
            break;
          case 'serviceId':
            value = reservation.serviceId;
            break;
          case 'staffId':
            value = reservation.staffId;
            break;
          case 'start':
            value = reservation.start as string;
            break;
          case 'end':
            value = reservation.end as string;
            break;
          default:
            value = (reservation as Record<string, unknown>)[col] as string | number | undefined;
        }
        return <td key={String(col)} className="p-2 border">{String(value ?? '')}</td>;
      })}
    </tr>
  );
});

export interface ReservationsTableProps {
  reservations: BookingEvent[];
  columns?: ColumnDef[];
  selectable?: boolean;
  onRowClick?: (r: BookingEvent) => void;
  onBulkAction?: (action: string, ids: string[]) => Promise<void>;
}

export const ReservationsTable: React.FC<ReservationsTableProps> = ({ reservations, columns, selectable = true, onRowClick, onBulkAction }) => {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const allSelected = useMemo(() => reservations.length > 0 && reservations.every(r => selected[r.id]), [reservations, selected]);
  const colDefs = columns || ['customer.name', 'serviceId', 'staffId', 'status', 'start', 'end'];

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelected({});
    } else {
      const next: Record<string, boolean> = {};
      for (const r of reservations) next[r.id] = true;
      setSelected(next);
    }
  }, [allSelected, reservations]);

  const toggle = useCallback((id: string) => {
    setSelected(prev => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const bulk = useCallback(async (action: string) => {
    if (!onBulkAction) return;
    const ids = Object.keys(selected).filter(k => selected[k]);
    if (ids.length === 0) return;
    await onBulkAction(action, ids);
    setSelected({});
  }, [onBulkAction, selected]);

  const handleConfirm = useCallback(() => bulk('confirm'), [bulk]);
  const handleCancel = useCallback(() => bulk('cancel'), [bulk]);
  const handleMarkPaid = useCallback(() => bulk('mark_paid'), [bulk]);

  return (
    <div className="w-full">
      {onBulkAction && (
        <div className="mb-2 flex items-center gap-2 text-xs">
          <button className="px-2 py-1 border rounded bg-gray-50" onClick={handleConfirm}>Confirm</button>
          <button className="px-2 py-1 border rounded bg-gray-50" onClick={handleCancel}>Cancel</button>
          <button className="px-2 py-1 border rounded bg-gray-50" onClick={handleMarkPaid}>Mark Paid</button>
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
            <ReservationRow
              key={r.id}
              reservation={r}
              colDefs={colDefs}
              selectable={selectable}
              isSelected={!!selected[r.id]}
              onRowClick={onRowClick}
              onToggle={toggle}
            />
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
