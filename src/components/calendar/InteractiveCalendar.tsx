'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Calendar, momentLocalizer, View, ToolbarProps } from 'react-big-calendar';
import moment from 'moment';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import StaffSidebar from './StaffSidebar';
import AppointmentModal from './AppointmentModal';
import CreateAppointmentModal from './CreateAppointmentModal';
import { authFetch } from '@/lib/auth/auth-api-client';

// Setup the localizer by providing the moment Object
const localizer = momentLocalizer(moment);

// Palette for auto-assigning colors to staff
const STAFF_COLORS = [
  '#3174ad', '#2ca02c', '#d62728', '#9467bd',
  '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22',
];

// Define the structure of a calendar event
interface CalendarEvent {
  id: number;
  title: string;
  start: Date;
  end: Date;
  resourceId: number;
}

// Define the structure for a resource (e.g., a staff member)
interface Resource {
  resourceId: number;
  resourceTitle: string;
  color: string;
}

interface SlotInfo {
  start: Date;
  end: Date;
}

const CustomToolbar: React.FC<ToolbarProps> = ({ label, onNavigate, onView }) => {
  return (
    <div className="rbc-toolbar">
      <span className="rbc-btn-group">
        <button type="button" onClick={() => onNavigate('PREV')}>
          Back
        </button>
        <button type="button" onClick={() => onNavigate('TODAY')}>
          Today
        </button>
        <button type="button" onClick={() => onNavigate('NEXT')}>
          Next
        </button>
      </span>
      <span className="rbc-toolbar-label">{label}</span>
      <span className="rbc-btn-group">
        <button type="button" onClick={() => onView('month')}>
          Month
        </button>
        <button type="button" onClick={() => onView('week')}>
          Week
        </button>
        <button type="button" onClick={() => onView('day')}>
          Day
        </button>
      </span>
    </div>
  );
};

const InteractiveCalendar: React.FC = () => {
  const [view, setView] = useState<View>('month');
  const [date, setDate] = useState(new Date());
  const [selectedStaff, setSelectedStaff] = useState<number[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [slotInfo, setSlotInfo] = useState<SlotInfo | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);

  const { data: staffData, isLoading: staffLoading } = useQuery({
    queryKey: ['calendar-staff'],
    queryFn: async () => {
      const res = await authFetch<{ staff: Array<{ id: string; name: string; email: string }> }>('/api/staff');
      return res.status === 200 ? (res.data?.staff ?? []) : [];
    },
  });

  const { data: reservationsData, isLoading: reservationsLoading } = useQuery({
    queryKey: ['calendar-reservations'],
    queryFn: async () => {
      const res = await authFetch<{ data: Array<{ id: string; title?: string; service_id?: string; staff_id?: string; start_at: string; end_at: string; status?: string }> }>('/api/reservations');
      return res.status === 200 ? (res.data?.data ?? []) : [];
    },
  });

  const staffList = staffData ?? [];
  const resources: Resource[] = useMemo(() => (staffData ?? []).map((s, idx) => ({
    resourceId: idx + 1,
    resourceTitle: s.name || s.email || s.id,
    color: STAFF_COLORS[idx % STAFF_COLORS.length],
  })), [staffData]);

  const staffIdToResourceId = useMemo(
    () => new Map((staffData ?? []).map((s, idx) => [s.id, idx + 1])),
    [staffData]
  );

  // Sync selectedStaff when resources change
  useEffect(() => {
    setSelectedStaff(resources.map(r => r.resourceId));
  }, [resources]);

  // Derive builtEvents from reservations query data
  const builtEvents: CalendarEvent[] = useMemo(() => {
    return (reservationsData ?? [])
      .filter(r => r.start_at && r.end_at)
      .map((r, idx) => {
        const resourceId = staffIdToResourceId.get(r.staff_id ?? '');
        return {
          id: idx + 1,
          title: r.title ?? r.service_id ?? 'Booking',
          start: new Date(r.start_at),
          end: new Date(r.end_at),
          ...(resourceId !== undefined ? { resourceId } : {}),
        };
      });
  }, [reservationsData, staffIdToResourceId]);

  // Merge query-derived events with locally created events
  const allEvents = useMemo(() => {
    const localIds = new Set(builtEvents.map(e => e.id));
    return [...builtEvents, ...events.filter(e => !localIds.has(e.id))];
  }, [builtEvents, events]);

  const loading = staffLoading || reservationsLoading;

  const handleStaffSelectionChange = (selectedIds: number[]) => {
    setSelectedStaff(selectedIds);
  };

  const filteredResources = resources.filter(r => selectedStaff.includes(r.resourceId));

  const eventPropGetter = (event: CalendarEvent) => {
    const resource = resources.find(r => r.resourceId === event.resourceId);
    return {
      style: {
        backgroundColor: resource ? resource.color : '#808080',
      },
    };
  };

  const handleSelectEvent = (event: CalendarEvent) => {
    // Only show event modal, don't create new appointment
    // Prevent both modals from showing at once
    if (slotInfo) return;
    setSelectedEvent(event);
    setSlotInfo(null);
  };

  const handleSelectSlot = (slot: SlotInfo) => {
    // Only show create modal for empty slots
    // Prevent both modals from showing at once
    if (selectedEvent) return;
    setSlotInfo(slot);
    setSelectedEvent(null);
  };

  const handleCreateEvent = (newEvent: Omit<CalendarEvent, 'id'>) => {
    const id = allEvents.length > 0 ? Math.max(...allEvents.map(e => e.id)) + 1 : 1;
    setEvents(prev => [...prev, { ...newEvent, id }]);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        Loading schedule…
      </div>
    );
  }

  return (
    <div className="flex" style={{ height: '100vh' }}>
      <StaffSidebar
        staff={resources}
        selectedStaff={selectedStaff}
        onSelectionChange={handleStaffSelectionChange}
      />
      <div className="flex-grow">
        <Calendar
          localizer={localizer}
          events={allEvents}
          resources={view === 'day' ? filteredResources : undefined}
          startAccessor="start"
          endAccessor="end"
          view={view}
          date={date}
          onView={(newView: View) => setView(newView)}
          onNavigate={(newDate: Date) => setDate(newDate)}
          style={{ height: '100%' }}
          resourceIdAccessor="resourceId"
          resourceTitleAccessor="resourceTitle"
          eventPropGetter={eventPropGetter}
          selectable
          onSelectSlot={handleSelectSlot}
          onSelectEvent={handleSelectEvent}
          components={{
            toolbar: CustomToolbar,
          }}
        />
      </div>
      <AppointmentModal event={selectedEvent} onClose={() => setSelectedEvent(null)} />
      <CreateAppointmentModal
        slotInfo={slotInfo}
        onClose={() => setSlotInfo(null)}
        onCreate={handleCreateEvent}
      />
    </div>
  );
};

export default InteractiveCalendar;
