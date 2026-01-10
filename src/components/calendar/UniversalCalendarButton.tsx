'use client';

import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { 
  Calendar, 
  ChevronDown, 
  ExternalLink, 
  Download,
  Clock
} from 'lucide-react';
import { 
  generateCalendarLinks, 
  type BookingEvent, 
  type CalendarLink,
  type CalendarButtonProps 
} from '@/lib/integrations/universalCalendar';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

/**
 * Universal Calendar Button Component
 * 
 * Provides 'Add to Calendar' functionality for all major calendar applications
 * Supports Google, Outlook, Yahoo, Apple Calendar, and ICS download
 */
export default function UniversalCalendarButton({ 
  event, 
  variant = 'dropdown',
  className,
  onLinkGenerated
}: CalendarButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [calendarLinks, setCalendarLinks] = useState<CalendarLink[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerateLinks = useCallback(async () => {
    if (calendarLinks.length > 0) return calendarLinks;

    setIsGenerating(true);
    try {
      const links = generateCalendarLinks(event);
      setCalendarLinks(links);
      onLinkGenerated?.(links);
      return links;
    } catch (error) {
      console.error('Error generating calendar links:', error);
      toast.error('Failed to generate calendar links');
      return [];
    } finally {
      setIsGenerating(false);
    }
  }, [event, calendarLinks, onLinkGenerated]);

  const handleCalendarClick = useCallback(async (link: CalendarLink) => {
    if (link.name.includes('Apple') || link.name.includes('Other')) {
      // Handle ICS download
      const icsContent = link.url;
      const element = document.createElement('a');
      element.setAttribute('href', icsContent);
      element.setAttribute('download', `booking-${event.title.replace(/[^a-zA-Z0-9]/g, '_')}.ics`);
      element.style.display = 'none';
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);
      toast.success('Calendar file downloaded');
    } else {
      // Open external calendar link
      window.open(link.url, '_blank', 'noopener,noreferrer');
      toast.success(`Opening ${link.name}`);
    }
    setIsOpen(false);
  }, [event.title]);

  const getCalendarIcon = (iconName: string) => {
    switch (iconName) {
      case 'google':
        return <div className="w-4 h-4 rounded bg-blue-500" />;
      case 'microsoft':
        return <div className="w-4 h-4 rounded bg-blue-600" />;
      case 'yahoo':
        return <div className="w-4 h-4 rounded bg-purple-500" />;
      default:
        return <Calendar className="h-4 w-4" />;
    }
  };

  // Inline variant - simple button that opens first available calendar
  if (variant === 'inline') {
    return (
      <Button
        variant="outline"
        size="sm"
        className={cn('gap-2', className)}
        onClick={async () => {
          const links = await handleGenerateLinks();
          if (links.length > 0) {
            handleCalendarClick(links[0]);
          }
        }}
        disabled={isGenerating}
      >
        <Calendar className="h-4 w-4" />
        {isGenerating ? 'Generating...' : 'Add to Calendar'}
      </Button>
    );
  }

  // Default dropdown variant
  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant === 'default' ? 'default' : 'outline'}
          className={cn('gap-2', className)}
          onClick={handleGenerateLinks}
          disabled={isGenerating}
        >
          <Calendar className="h-4 w-4" />
          {isGenerating ? 'Generating...' : 'Add to Calendar'}
          <ChevronDown className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-2 py-1.5 text-sm font-medium text-muted-foreground">
          Add to Calendar
        </div>
        <DropdownMenuSeparator />
        
        {calendarLinks.map((link) => (
          <DropdownMenuItem
            key={link.name}
            onClick={() => handleCalendarClick(link)}
            className="gap-3 cursor-pointer"
          >
            {getCalendarIcon(link.icon)}
            <span className="flex-1">{link.name}</span>
            {link.name.includes('Apple') || link.name.includes('Other') ? (
              <Download className="h-4 w-4" />
            ) : (
              <ExternalLink className="h-4 w-4" />
            )}
          </DropdownMenuItem>
        ))}
        
        <DropdownMenuSeparator />
        <div className="px-2 py-1.5 text-xs text-muted-foreground flex items-center gap-2">
          <Clock className="h-3 w-3" />
          {event.startTime.toLocaleString()}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Quick Add Calendar Component for booking confirmations
 */
export function QuickAddCalendar({ 
  booking,
  className 
}: { 
  booking: any;
  className?: string;
}) {
  // Convert booking to calendar event
  const calendarEvent: BookingEvent = {
    title: `${booking.service_name} - ${booking.tenant?.business_name || 'Appointment'}`,
    description: `Service: ${booking.service_name}\nCustomer: ${booking.customer_name}${booking.notes ? `\nNotes: ${booking.notes}` : ''}`,
    location: booking.location || booking.tenant?.business_name || '',
    startTime: new Date(`${booking.appointment_date}T${booking.appointment_time}`),
    endTime: new Date(new Date(`${booking.appointment_date}T${booking.appointment_time}`).getTime() + (booking.duration_minutes || 60) * 60000),
    organizer: {
      name: booking.tenant?.business_name || 'Business',
      email: booking.tenant?.contact_email || ''
    },
    attendees: [
      {
        name: booking.customer_name,
        email: booking.customer_email || ''
      }
    ].filter(attendee => attendee.email)
  };

  return (
    <UniversalCalendarButton
      event={calendarEvent}
      variant="dropdown"
      className={className}
    />
  );
}
