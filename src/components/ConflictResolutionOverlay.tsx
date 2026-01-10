"use client";
import React from 'react';

interface ConflictEvent {
  id: string;
  start: string;
  end: string;
  staffId?: string;
  serviceId?: string;
  status?: string;
  customer?: { id?: string; name?: string };
  serviceName?: string;
}

export interface ConflictResolutionOverlayProps {
  targetStart: string;
  targetEnd: string;
  staffId?: string;
  conflicts: ConflictEvent[];
  source?: 'server' | 'local';
  onClose: () => void;
  onSelectAlternative: (start: string, end: string, staffId?: string) => void;
}

function minutesBetween(a: Date, b: Date) { return Math.round((b.getTime() - a.getTime())/60000); }
function addMinutes(d: Date, m: number) { return new Date(d.getTime() + m*60000); }

// Simple alternative slot generator: scan forward in 15m increments up to 10 attempts.
function isWithinWorkingHours(date: Date) {
  const h = date.getHours();
  return h >= 8 && h < 20; // 08:00-20:00 default window
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
}

function computeAlternatives(targetStart: string, targetEnd: string, conflicts: ConflictEvent[]) {
  const startDate = new Date(targetStart);
  const endDate = new Date(targetEnd);
  const duration = minutesBetween(startDate, endDate);
  const attempts = 10;
  const step = 15; // minutes
  const alts: { start: string; end: string }[] = [];
  let cursor = addMinutes(endDate, step); // begin after desired end
  for (let i=0;i<attempts;i++) {
    const slotStart = cursor;
    const slotEnd = addMinutes(slotStart, duration);
    // Respect day and business hours
    if (!sameDay(startDate, slotStart) || !isWithinWorkingHours(slotStart) || !isWithinWorkingHours(slotEnd)) {
      cursor = addMinutes(cursor, step);
      continue;
    }
    const overlap = conflicts.some(ev => {
      const evStart = new Date(ev.start);
      const evEnd = new Date(ev.end);
      return !(slotEnd <= evStart || slotStart >= evEnd); // intervals overlap
    });
    if (!overlap) {
      alts.push({ start: slotStart.toISOString(), end: slotEnd.toISOString() });
      if (alts.length >= 5) break;
    }
    cursor = addMinutes(cursor, step);
  }
  return alts;
}

export const ConflictResolutionOverlay: React.FC<ConflictResolutionOverlayProps> = ({ targetStart, targetEnd, staffId, conflicts, source = 'local', onClose, onSelectAlternative }) => {
  const alternatives = computeAlternatives(targetStart, targetEnd, conflicts);
  const [showDetails, setShowDetails] = React.useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-xl bg-white rounded shadow-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold">Scheduling Conflict</h2>
        <p className="text-sm text-gray-600">The selected time overlaps with existing bookings. Choose an alternative slot or adjust manually.</p>
        <div className="text-[11px] text-gray-500">Source: {source === 'server' ? 'Server-reported conflicts' : 'Local detection'}</div>
        {source === 'server' && conflicts.length > 0 && (
          <button
            onClick={()=>setShowDetails(v=>!v)}
            className="text-[11px] underline text-indigo-600"
            aria-expanded={showDetails}
          >{showDetails ? 'Hide server details' : 'Show server details'}</button>
        )}
        {showDetails && source === 'server' && (
          <div className="border rounded p-2 bg-gray-50 space-y-1 text-[11px]" aria-label="server-conflict-details">
            {conflicts.map(c => (
              <div key={c.id} className="flex justify-between">
                <span>{new Date(c.start).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}–{new Date(c.end).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                <span className="text-gray-600">{c.staffId ? `Staff: ${c.staffId}` : ''}{c.serviceName ? ` • ${c.serviceName}` : ''}</span>
              </div>
            ))}
          </div>
        )}
        <div className="border rounded p-3 max-h-48 overflow-y-auto space-y-2" aria-label="conflicting-events-list">
          {conflicts.map(c => (
            <div key={c.id} className="text-xs flex justify-between border-b pb-1">
              <span>{new Date(c.start).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}–{new Date(c.end).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
              <span className="uppercase tracking-wide text-gray-500">{c.status || 'booked'}</span>
            </div>
          ))}
          {conflicts.length === 0 && <div className="text-xs text-gray-500">No conflicts found (server returned 409)</div>}
        </div>
        <div>
          <h3 className="text-sm font-medium mb-2">Suggested Alternatives</h3>
          <div className="flex flex-wrap gap-2">
            {alternatives.map(a => (
              <button
                key={a.start}
                onClick={()=>onSelectAlternative(a.start, a.end, staffId)}
                className="px-2 py-1 text-xs rounded border hover:bg-indigo-50"
              >{new Date(a.start).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}–{new Date(a.end).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</button>
            ))}
            {alternatives.length === 0 && <span className="text-xs text-gray-500">No immediate alternatives found. Try manual adjustment.</span>}
          </div>
        </div>
        <div className="flex justify-end gap-3 text-sm">
          <button onClick={onClose} className="px-3 py-1 rounded border">Cancel</button>
        </div>
      </div>
    </div>
  );
};

export default ConflictResolutionOverlay;
