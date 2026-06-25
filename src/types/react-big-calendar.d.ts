declare module 'react-big-calendar' {
  import React from 'react';

  export interface Event {
    title?: string;
    start: Date;
    end: Date;
    allDay?: boolean;
    resource?: any;
    [key: string]: any;
  }

  export interface CalendarProps {
    events?: Event[];
    localizer?: any;
    defaultDate?: Date;
    defaultView?: string;
    views?: string[] | object;
    step?: number;
    showMultiDayTimes?: boolean;
    onSelectEvent?: (event: Event, e: React.SyntheticEvent) => void;
    onSelectSlot?: (slotInfo: any) => void;
    selectable?: boolean;
    style?: React.CSSProperties;
    className?: string;
    eventPropGetter?: (event: Event, start: Date, end: Date, isSelected: boolean) => { className?: string; style?: React.CSSProperties };
    components?: Record<string, any>;
    [key: string]: any;
  }

  export type View = 'month' | 'week' | 'work_week' | 'day' | 'agenda';
  export interface ToolbarProps {
    date: Date;
    view: View;
    views: View[];
    label: string;
    onNavigate: (action: 'PREV' | 'NEXT' | 'TODAY' | 'DATE', date?: Date) => void;
    onView: (view: View) => void;
  }

  export const Calendar: React.FC<CalendarProps>;
  export function momentLocalizer(moment: any): any;
  export function dateFnsLocalizer(config: any): any;
}
