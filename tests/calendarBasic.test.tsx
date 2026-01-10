// Jest globals are available without import
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Calendar, BookingEvent } from '@/components/Calendar';

const baseEvent: BookingEvent = {
  id: 'e1',
  start: new Date().toISOString(),
  end: new Date(Date.now()+3600000).toISOString(),
  status: 'requested',
  serviceId: 'svc1',
  staffId: 'staff1',
  customer: { id: 'c1', name: 'Alice' }
};

describe('Calendar skeleton', () => {
  it('renders events in basic view', () => {
    render(<Calendar view="day" events={[baseEvent]} />);
    expect(screen.getByLabelText('calendar-basic')).toBeTruthy();
    expect(screen.getByText('Alice')).toBeTruthy();
  });
  it('invokes onEventClick', () => {
    const onClick = jest.fn();
    render(<Calendar view="day" events={[baseEvent]} onEventClick={onClick} />);
    fireEvent.click(screen.getByText('Alice'));
    expect(onClick).toHaveBeenCalledWith(baseEvent);
  });
  it('renders staff lanes', () => {
    render(<Calendar view="day" events={[baseEvent]} staffLanes />);
    expect(screen.getByLabelText('calendar-staff-lanes')).toBeTruthy();
  });
});
