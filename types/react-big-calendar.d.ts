/**
 * Minimal hand-written types for react-big-calendar.
 *
 * The package ships no types and `@types/react-big-calendar` is not installed,
 * so this file used to be a bare `declare module 'react-big-calendar';` — a
 * wildcard that makes every import `any`. That is why `type Event as
 * BigCalendarEvent` read as a namespace rather than a type, and why every
 * callback parameter below was an implicit `any`.
 *
 * Only what src/components/calendar/InteractiveCalendar.tsx actually uses is
 * declared. Widen it when a new prop is needed rather than reaching back for
 * the wildcard.
 */
declare module 'react-big-calendar' {
  import type { ComponentType, CSSProperties } from 'react';

  /** The view names the library ships with. */
  export type View = 'month' | 'week' | 'work_week' | 'day' | 'agenda';

  export interface Event {
    title?: React.ReactNode;
    start?: Date;
    end?: Date;
    allDay?: boolean;
    resource?: unknown;
    [key: string]: unknown;
  }

  export interface SlotInfo {
    start: Date;
    end: Date;
    slots: Date[];
    action: 'select' | 'click' | 'doubleClick';
    resourceId?: string | number;
  }

  export interface DateLocalizer {
    format(value: Date, format: string, culture?: string): string;
    [key: string]: unknown;
  }

  export function momentLocalizer(moment: unknown): DateLocalizer;

  export interface CalendarProps<TEvent = Event, TResource = object> {
    localizer: DateLocalizer;
    events?: TEvent[];
    resources?: TResource[];
    startAccessor?: string | ((event: TEvent) => Date);
    endAccessor?: string | ((event: TEvent) => Date);
    resourceIdAccessor?: string | ((resource: TResource) => string | number);
    resourceTitleAccessor?: string | ((resource: TResource) => string);
    view?: View;
    views?: View[] | Record<string, boolean | ComponentType>;
    date?: Date;
    style?: CSSProperties;
    selectable?: boolean | 'ignoreEvents';
    onView?: (view: View) => void;
    onNavigate?: (date: Date) => void;
    onSelectSlot?: (slot: SlotInfo) => void;
    onSelectEvent?: (event: TEvent) => void;
    eventPropGetter?: (event: TEvent) => { className?: string; style?: CSSProperties };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the library accepts any component here
    components?: Record<string, ComponentType<any>>;
    [key: string]: unknown;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic component, callers narrow
  export const Calendar: ComponentType<CalendarProps<any, any>>;
}
