/**
 * Shared calendar type definitions.
 * These types are used across all calendar components to ensure consistency.
 */

/** Represents a single event rendered on the calendar grid. */
export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  /** Numeric ID matching the `resourceId` of the staff member resource. */
  resourceId: number;
}
