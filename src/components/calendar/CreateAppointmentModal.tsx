'use client';

import React, { useState, useEffect, useRef } from 'react';
import GlassCard from '@/components/ui/GlassCard';

interface SlotInfo {
  start: Date;
  end: Date;
}

interface CreateAppointmentModalProps {
  slotInfo: SlotInfo | null;
  onClose: () => void;
  onCreate: (event: Omit<CalendarEvent, 'id'>) => void;
}

interface CalendarEvent {
  id: number;
  title: string;
  start: Date;
  end: Date;
  resourceId: number;
}

const CreateAppointmentModal: React.FC<CreateAppointmentModalProps> = ({
  slotInfo,
  onClose,
  onCreate,
}) => {
  const [title, setTitle] = useState('');
  const [resourceId, setResourceId] = useState(1);
  const [visible, setVisible] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!slotInfo) {
      setVisible(false);
      return;
    }
    // Small delay to trigger CSS transition
    const t = setTimeout(() => setVisible(true), 10);
    // Autofocus first focusable element inside the modal when opening
    const focusTimer = setTimeout(() => {
      try {
        if (contentRef.current) {
          const first = contentRef.current.querySelector<HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement | HTMLElement>('input, button, select, textarea, [tabindex]:not([tabindex="-1"])');
          (first as HTMLElement | null)?.focus?.();
        }
      } catch (e) {
        // ignore
      }
    }, 120);
    return () => { clearTimeout(t); clearTimeout(focusTimer); };
  }, [slotInfo]);

  if (!slotInfo) {
    return null;
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreate({
      title,
      start: slotInfo.start,
      end: slotInfo.end,
      resourceId,
    });
    setTitle('');
    setResourceId(1);
    onClose();
  };

  return (
    // Backdrop: clicking it closes the modal (z-50 to stay above AppointmentModal at z-40)
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 transition duration-200" onClick={onClose}>
      {/* Stop propagation inside the content area so clicks do not close the modal */}
      <div onClick={(e) => e.stopPropagation()} ref={contentRef}>
        {/* Subtle entrance animation using opacity + scale */}
        <GlassCard
          className={`p-6 min-w-[350px] max-w-md relative transition duration-150 ${
            visible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
          }`}
        >
          <button
            type="button"
            className="absolute top-3 right-3 text-gray-500 hover:text-gray-700 text-xl leading-none"
            onClick={onClose}
          >
            &times;
          </button>

          <h2 className="text-xl font-bold mb-4 pr-6">Create Appointment</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Appointment title"
                required
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Staff
              </label>
              <select
                value={resourceId}
                onChange={(e) => setResourceId(Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value={1}>Alice</option>
                <option value={2}>Bob</option>
              </select>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition duration-150 font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition duration-150 font-medium"
              >
                Create
              </button>
            </div>
          </form>
        </GlassCard>
      </div>
    </div>
  );
};

export default CreateAppointmentModal;
