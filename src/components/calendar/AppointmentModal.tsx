'use client';

import React from 'react';

interface CalendarEvent {
  id: number;
  title: string;
  start: Date;
  end: Date;
  resourceId: number;
}

interface AppointmentModalProps {
  event: CalendarEvent | null;
  onClose: () => void;
}

const AppointmentModal: React.FC<AppointmentModalProps> = ({ event, onClose }) => {
  if (!event) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex justify-center items-center" onClick={onClose}>
      <div className="relative bg-white p-6 rounded-lg shadow-lg w-1/3 transition duration-200" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="absolute top-3 right-3 text-gray-500 hover:text-gray-700 text-xl leading-none"
          onClick={onClose}
        >
          &times;
        </button>
        <h2 className="text-xl font-bold mb-4 pr-6">{event.title}</h2>
        <p className="mb-2">
          <strong>Start:</strong> {event.start.toLocaleString()}
        </p>
        <p className="mb-2">
          <strong>End:</strong> {event.end.toLocaleString()}
        </p>
        <p className="mb-4">
          <strong>Staff ID:</strong> {event.resourceId}
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition duration-150 font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default AppointmentModal;
