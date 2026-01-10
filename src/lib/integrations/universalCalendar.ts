/**
 * Universal Calendar Integration
 * 
 * Generates 'Add to Calendar' links that work across all major calendar applications:
 * - Google Calendar
 * - Apple Calendar
 * - Outlook (web and desktop)
 * - Yahoo Calendar
 * - ICS download for other applications
 */

export interface BookingEvent {
  title: string;
  description?: string;
  location?: string;
  startTime: Date;
  endTime: Date;
  timezone?: string;
  organizer?: {
    name: string;
    email: string;
  };
  attendees?: Array<{
    name: string;
    email: string;
  }>;
}

export interface CalendarLink {
  name: string;
  url: string;
  icon: string; // Icon name for UI
}

/**
 * Format date for calendar URLs (YYYYMMDDTHHMMSSZ format)
 */
function formatCalendarDate(date: Date): string {
  return date.toISOString().replace(/[-:.]/g, '').split('.')[0] + 'Z';
}

/**
 * Encode text for URL parameters
 */
function encodeCalendarText(text: string): string {
  return encodeURIComponent(text);
}

/**
 * Generate Google Calendar link
 */
function generateGoogleCalendarLink(event: BookingEvent): string {
  const baseUrl = 'https://calendar.google.com/calendar/render';
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${formatCalendarDate(event.startTime)}/${formatCalendarDate(event.endTime)}`,
    details: event.description || '',
    location: event.location || '',
    ctz: event.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
  });

  return `${baseUrl}?${params.toString()}`;
}

/**
 * Generate Outlook (web) calendar link
 */
function generateOutlookWebLink(event: BookingEvent): string {
  const baseUrl = 'https://outlook.live.com/calendar/0/deeplink/compose';
  const params = new URLSearchParams({
    subject: event.title,
    startdt: event.startTime.toISOString(),
    enddt: event.endTime.toISOString(),
    body: event.description || '',
    location: event.location || ''
  });

  return `${baseUrl}?${params.toString()}`;
}

/**
 * Generate Yahoo Calendar link
 */
function generateYahooCalendarLink(event: BookingEvent): string {
  const baseUrl = 'https://calendar.yahoo.com/';
  const params = new URLSearchParams({
    v: '60',
    view: 'd',
    type: '20',
    title: event.title,
    st: formatCalendarDate(event.startTime),
    et: formatCalendarDate(event.endTime),
    desc: event.description || '',
    in_loc: event.location || ''
  });

  return `${baseUrl}?${params.toString()}`;
}

/**
 * Generate ICS file content for download
 */
function generateICSContent(event: BookingEvent): string {
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Booka//Booking System//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `DTSTART:${formatCalendarDate(event.startTime)}`,
    `DTEND:${formatCalendarDate(event.endTime)}`,
    `SUMMARY:${event.title}`,
    `DESCRIPTION:${event.description || ''}`,
    `LOCATION:${event.location || ''}`,
    `UID:booking-${Date.now()}@booka.app`,
    `DTSTAMP:${formatCalendarDate(new Date())}`,
    'STATUS:CONFIRMED',
    'SEQUENCE:0'
  ];

  if (event.organizer) {
    ics.push(`ORGANIZER;CN=${event.organizer.name}:mailto:${event.organizer.email}`);
  }

  if (event.attendees && event.attendees.length > 0) {
    event.attendees.forEach(attendee => {
      ics.push(`ATTENDEE;CN=${attendee.name}:mailto:${attendee.email}`);
    });
  }

  ics.push('END:VEVENT', 'END:VCALENDAR');
  return ics.join('\r\n');
}

/**
 * Generate data URL for ICS file download
 */
function generateICSDataUrl(event: BookingEvent): string {
  const icsContent = generateICSContent(event);
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  return URL.createObjectURL(blob);
}

/**
 * Generate all calendar links for a booking event
 */
export function generateCalendarLinks(event: BookingEvent): CalendarLink[] {
  return [
    {
      name: 'Google Calendar',
      url: generateGoogleCalendarLink(event),
      icon: 'google'
    },
    {
      name: 'Outlook',
      url: generateOutlookWebLink(event),
      icon: 'microsoft'
    },
    {
      name: 'Yahoo Calendar',
      url: generateYahooCalendarLink(event),
      icon: 'yahoo'
    },
    {
      name: 'Apple Calendar / Other',
      url: generateICSDataUrl(event),
      icon: 'calendar'
    }
  ];
}

/**
 * Convert booking data to calendar event
 */
export function bookingToCalendarEvent(booking: {
  id: string;
  service_name: string;
  appointment_date: string;
  appointment_time: string;
  duration_minutes: number;
  customer_name: string;
  customer_email?: string;
  staff_name?: string;
  staff_email?: string;
  location?: string;
  notes?: string;
  tenant: {
    business_name: string;
    contact_email: string;
  };
}): BookingEvent {
  const startTime = new Date(`${booking.appointment_date}T${booking.appointment_time}`);
  const endTime = new Date(startTime.getTime() + booking.duration_minutes * 60000);

  return {
    title: `${booking.service_name} - ${booking.tenant.business_name}`,
    description: [
      `Service: ${booking.service_name}`,
      `Customer: ${booking.customer_name}`,
      booking.staff_name ? `Staff: ${booking.staff_name}` : '',
      booking.notes ? `Notes: ${booking.notes}` : '',
      '',
      'Powered by Booka Booking System'
    ].filter(Boolean).join('\n'),
    location: booking.location || booking.tenant.business_name,
    startTime,
    endTime,
    organizer: {
      name: booking.tenant.business_name,
      email: booking.tenant.contact_email
    },
    attendees: [
      {
        name: booking.customer_name,
        email: booking.customer_email || ''
      },
      ...(booking.staff_name && booking.staff_email ? [{
        name: booking.staff_name,
        email: booking.staff_email
      }] : [])
    ].filter(attendee => attendee.email)
  };
}

/**
 * Universal calendar button component props
 */
export interface CalendarButtonProps {
  event: BookingEvent;
  variant?: 'default' | 'dropdown' | 'inline';
  className?: string;
  onLinkGenerated?: (links: CalendarLink[]) => void;
}
