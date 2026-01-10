'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Calendar,
  MapPin,
  Clock,
  User,
  Mail,
  Phone,
  CheckCircle
} from 'lucide-react';
import { UniversalCalendarButton, QuickAddCalendar } from '@/components/calendar/UniversalCalendarButton';
import { formatDate, formatTime } from '@/lib/utils';

export interface BookingConfirmationProps {
  booking: {
    id: string;
    service_name: string;
    appointment_date: string;
    appointment_time: string;
    duration_minutes?: number;
    customer_name: string;
    customer_email?: string;
    customer_phone?: string;
    staff_name?: string;
    staff_email?: string;
    location?: string;
    notes?: string;
    status: string;
    tenant?: {
      business_name: string;
      contact_email: string;
      contact_phone?: string;
      address?: string;
    };
  };
  variant?: 'email' | 'card' | 'minimal';
  showCalendarButton?: boolean;
  className?: string;
}

/**
 * Booking Confirmation Component
 * 
 * Displays booking confirmation with universal calendar integration
 * Can be used for emails, dashboard cards, or minimal confirmations
 */
export default function BookingConfirmation({
  booking,
  variant = 'card',
  showCalendarButton = true,
  className
}: BookingConfirmationProps) {
  const appointmentDateTime = new Date(`${booking.appointment_date}T${booking.appointment_time}`);
  const endTime = new Date(appointmentDateTime.getTime() + (booking.duration_minutes || 60) * 60000);
  
  const statusColor = {
    confirmed: 'bg-green-100 text-green-800 border-green-200',
    pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    cancelled: 'bg-red-100 text-red-800 border-red-200',
    completed: 'bg-blue-100 text-blue-800 border-blue-200'
  }[booking.status] || 'bg-gray-100 text-gray-800 border-gray-200';

  // Minimal variant for quick confirmations
  if (variant === 'minimal') {
    return (
      <div className={`space-y-3 ${className}`}>
        <div className=\"flex items-center justify-between\">
          <div className=\"flex items-center gap-2\">
            <CheckCircle className=\"h-5 w-5 text-green-600\" />
            <span className=\"font-medium\">Booking Confirmed</span>
          </div>
          <Badge variant=\"outline\" className={statusColor}>
            {booking.status}
          </Badge>
        </div>
        
        <div className=\"text-sm space-y-1\">
          <div className=\"flex items-center gap-2\">
            <Calendar className=\"h-4 w-4 text-muted-foreground\" />
            {formatDate(appointmentDateTime)} at {formatTime(appointmentDateTime)}
          </div>
          <div className=\"flex items-center gap-2\">
            <User className=\"h-4 w-4 text-muted-foreground\" />
            {booking.service_name}
          </div>
        </div>
        
        {showCalendarButton && (
          <QuickAddCalendar booking={booking} className=\"w-full\" />
        )}
      </div>
    );
  }

  // Email variant for email templates
  if (variant === 'email') {
    return (
      <div className={`max-w-2xl mx-auto bg-white border border-gray-200 rounded-lg ${className}`} style={{ fontFamily: 'Arial, sans-serif' }}>
        {/* Header */}
        <div className=\"bg-green-50 px-6 py-4 border-b border-green-200\">
          <div className=\"flex items-center gap-3\">
            <div className=\"w-8 h-8 bg-green-600 rounded-full flex items-center justify-center\">
              <CheckCircle className=\"h-5 w-5 text-white\" />
            </div>
            <div>
              <h1 className=\"text-xl font-semibold text-green-900\">Booking Confirmed!</h1>
              <p className=\"text-green-700 text-sm\">Your appointment has been successfully scheduled</p>
            </div>
          </div>
        </div>

        {/* Booking Details */}
        <div className=\"px-6 py-6\">
          <div className=\"grid grid-cols-1 md:grid-cols-2 gap-6\">
            {/* Left Column */}
            <div className=\"space-y-4\">
              <div className=\"flex items-start gap-3\">
                <Calendar className=\"h-5 w-5 text-blue-600 mt-0.5\" />
                <div>
                  <div className=\"font-medium text-gray-900\">Date & Time</div>
                  <div className=\"text-gray-700\">{formatDate(appointmentDateTime)}</div>
                  <div className=\"text-gray-700\">{formatTime(appointmentDateTime)} - {formatTime(endTime)}</div>
                </div>
              </div>

              <div className=\"flex items-start gap-3\">
                <User className=\"h-5 w-5 text-purple-600 mt-0.5\" />
                <div>
                  <div className=\"font-medium text-gray-900\">Service</div>
                  <div className=\"text-gray-700\">{booking.service_name}</div>
                  {booking.staff_name && (
                    <div className=\"text-sm text-gray-600\">with {booking.staff_name}</div>
                  )}
                </div>
              </div>

              {booking.location && (
                <div className=\"flex items-start gap-3\">
                  <MapPin className=\"h-5 w-5 text-red-600 mt-0.5\" />
                  <div>
                    <div className=\"font-medium text-gray-900\">Location</div>
                    <div className=\"text-gray-700\">{booking.location}</div>
                  </div>
                </div>
              )}
            </div>

            {/* Right Column */}
            <div className=\"space-y-4\">
              <div className=\"bg-gray-50 p-4 rounded-lg\">
                <div className=\"font-medium text-gray-900 mb-2\">Booking Details</div>
                <div className=\"space-y-1 text-sm\">
                  <div className=\"flex justify-between\">
                    <span>Booking ID:</span>
                    <span className=\"font-mono\">{booking.id}</span>
                  </div>
                  <div className=\"flex justify-between\">
                    <span>Duration:</span>
                    <span>{booking.duration_minutes || 60} minutes</span>
                  </div>
                  <div className=\"flex justify-between\">
                    <span>Status:</span>
                    <Badge variant=\"outline\" className={`${statusColor} text-xs`}>
                      {booking.status}
                    </Badge>
                  </div>
                </div>
              </div>

              {booking.notes && (
                <div className=\"bg-blue-50 p-4 rounded-lg\">
                  <div className=\"font-medium text-blue-900 mb-2\">Notes</div>
                  <div className=\"text-sm text-blue-800\">{booking.notes}</div>
                </div>
              )}
            </div>
          </div>

          {/* Calendar Integration */}
          {showCalendarButton && (
            <div className=\"mt-6 pt-6 border-t border-gray-200\">
              <div className=\"flex flex-col sm:flex-row items-start sm:items-center gap-4\">
                <div className=\"flex-1\">
                  <h3 className=\"font-medium text-gray-900\">Add to Your Calendar</h3>
                  <p className=\"text-sm text-gray-600\">Don't forget your appointment - add it to your calendar now</p>
                </div>
                <QuickAddCalendar booking={booking} />
              </div>
            </div>
          )}

          {/* Contact Information */}
          {booking.tenant && (
            <div className=\"mt-6 pt-6 border-t border-gray-200\">
              <h3 className=\"font-medium text-gray-900 mb-3\">Contact Information</h3>
              <div className=\"grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm\">
                <div className=\"flex items-center gap-2\">
                  <Mail className=\"h-4 w-4 text-gray-500\" />
                  <a href={`mailto:${booking.tenant.contact_email}`} className=\"text-blue-600 hover:underline\">
                    {booking.tenant.contact_email}
                  </a>
                </div>
                {booking.tenant.contact_phone && (
                  <div className=\"flex items-center gap-2\">
                    <Phone className=\"h-4 w-4 text-gray-500\" />
                    <a href={`tel:${booking.tenant.contact_phone}`} className=\"text-blue-600 hover:underline\">
                      {booking.tenant.contact_phone}
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Default card variant
  return (
    <Card className={className}>
      <CardHeader className=\"pb-4\">
        <div className=\"flex items-center justify-between\">
          <CardTitle className=\"flex items-center gap-2\">
            <CheckCircle className=\"h-5 w-5 text-green-600\" />
            Booking Confirmed
          </CardTitle>
          <Badge variant=\"outline\" className={statusColor}>
            {booking.status}
          </Badge>
        </div>
      </CardHeader>
      
      <CardContent className=\"space-y-4\">
        {/* Main booking info */}
        <div className=\"grid grid-cols-1 md:grid-cols-2 gap-4\">
          <div className=\"space-y-3\">
            <div className=\"flex items-center gap-3\">
              <Calendar className=\"h-4 w-4 text-muted-foreground\" />
              <div>
                <div className=\"font-medium\">{formatDate(appointmentDateTime)}</div>
                <div className=\"text-sm text-muted-foreground\">
                  {formatTime(appointmentDateTime)} - {formatTime(endTime)}
                </div>
              </div>
            </div>
            
            <div className=\"flex items-center gap-3\">
              <User className=\"h-4 w-4 text-muted-foreground\" />
              <div>
                <div className=\"font-medium\">{booking.service_name}</div>
                {booking.staff_name && (
                  <div className=\"text-sm text-muted-foreground\">with {booking.staff_name}</div>
                )}
              </div>
            </div>
            
            {booking.location && (
              <div className=\"flex items-center gap-3\">
                <MapPin className=\"h-4 w-4 text-muted-foreground\" />
                <div className=\"font-medium\">{booking.location}</div>
              </div>
            )}
          </div>
          
          <div className=\"space-y-3\">
            <div>
              <div className=\"text-sm text-muted-foreground\">Booking ID</div>
              <div className=\"font-mono text-sm\">{booking.id}</div>
            </div>
            
            <div>
              <div className=\"text-sm text-muted-foreground\">Duration</div>
              <div className=\"text-sm flex items-center gap-1\">
                <Clock className=\"h-3 w-3\" />
                {booking.duration_minutes || 60} minutes
              </div>
            </div>
          </div>
        </div>
        
        {booking.notes && (
          <div className=\"bg-muted/50 p-3 rounded-md\">
            <div className=\"text-sm font-medium mb-1\">Notes</div>
            <div className=\"text-sm text-muted-foreground\">{booking.notes}</div>
          </div>
        )}
        
        {/* Calendar integration */}
        {showCalendarButton && (
          <div className=\"pt-4 border-t\">
            <div className=\"flex items-center justify-between\">
              <div>
                <div className=\"font-medium\">Add to Calendar</div>
                <div className=\"text-sm text-muted-foreground\">Don't forget your appointment</div>
              </div>
              <QuickAddCalendar booking={booking} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Email-ready booking confirmation component
 */
export function BookingConfirmationEmail(props: BookingConfirmationProps) {
  return <BookingConfirmation {...props} variant=\"email\" />;
}

/**
 * Minimal booking confirmation for notifications
 */
export function BookingConfirmationMinimal(props: BookingConfirmationProps) {
  return <BookingConfirmation {...props} variant=\"minimal\" />;
}