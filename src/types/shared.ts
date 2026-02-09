// Shared types for booking flows

/**
 * Represents all possible steps in the booking flow.
 */
export type BookingStep =
  | 'intent'
  | 'service'
  | 'staff'
  | 'time'
  | 'contact'
  | 'confirm'
  | 'complete'
  | 'booking'
  | 'reschedule'
  | 'cancel'
  | 'inquiry'
  | 'business_info'
  | 'product_inquiry'
  | 'greeting'
  | 'service_selection'
  | 'date_time'
  | 'confirmation'
  | 'completed';

/**
 * Represents an available time slot for public booking.
 * Used by the availability API to show available booking times.
 */
export interface AvailabilityTimeSlot {
  /** Time in HH:mm format (e.g., "09:00") */
  time: string;
  /** Whether this slot is available for booking */
  available: boolean;
}