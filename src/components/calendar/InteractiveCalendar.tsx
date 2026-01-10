'use client';

import React, { useState } from 'react';
import { Calendar, momentLocalizer, View, ToolbarProps } from 'react-big-calendar';
import moment from 'moment';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import StaffSidebar from './StaffSidebar';
import AppointmentModal from './AppointmentModal';
import CreateAppointmentModal from './CreateAppointmentModal';

// Setup the localizer by providing the moment Object
const localizer = momentLocalizer(moment);

// Define the structure of a calendar event
interface CalendarEvent {
  id: number;
  title: string;
  start: Date;
  end: Date;
  resourceId: number;
  // Add any other properties you need for an event
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
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [view, setView] = useState<View>('month');
  const [date, setDate] = useState(new Date());
  const [selectedStaff, setSelectedStaff] = useState<number[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [slotInfo, setSlotInfo] = useState<SlotInfo | null>(null);

  // Placeholder data - we will replace this with data fetched from the API
  const placeholderEvents: CalendarEvent[] = [
    {
      id: 1,
      title: 'Meeting with Client',
      start: new Date(2025, 11, 12, 10, 0),
      end: new Date(2025, 11, 12, 11, 0),
      resourceId: 1,
    },
    {
      id: 2,
      title: 'Project Deadline',
      start: new Date(2025, 11, 15, 14, 0),
      end: new Date(2025, 11, 15, 15, 30),
      resourceId: 2,
    },
    {
      id: 3,
      title: 'Team Sync',
      start: new Date(2025, 11, 15, 9, 0),
      end: new Date(2025, 11, 15, 9, 30),
      resourceId: 1,
    },
  ];

  const placeholderResources: Resource[] = [
    { resourceId: 1, resourceTitle: 'Alice', color: '#3174ad' },
    { resourceId: 2, resourceTitle: 'Bob', color: '#2ca02c' },
  ];

  React.useEffect(() => {
    // In a real application, you would fetch your events and resources here
    setEvents(placeholderEvents);
    setResources(placeholderResources);
    // By default, select all staff
    setSelectedStaff(placeholderResources.map(r => r.resourceId));
  }, []);

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
    const id = Math.max(...events.map(e => e.id)) + 1;
    setEvents([...events, { ...newEvent, id }]);
  };

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
          events={events}
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
