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