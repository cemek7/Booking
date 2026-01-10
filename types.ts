// src/types.ts
// Booka frontend shared types (components + API shapes)
// Copy into your repo. Keep in sync with backend OpenAPI.

// Re-export comprehensive type definitions
export * from './src/types/roles';
export * from './src/types/permissions';
export * from './src/types/evolutionApi';
export * from './src/types/analytics';
export * from './src/types/bookingFlow';

// Legacy type definitions (maintained for backward compatibility)
// NOTE: Use canonical definition from src/types/roles.ts
export type { Role } from './src/types/roles';

export type ViewMode = 'month' | 'week' | 'day';

export type BookingStatus =
  | 'requested'
  | 'confirmed'
  | 'completed'
  | 'cancelled'
  | 'no_show';

export interface User {
  userId: string;
  name: string;
  email?: string;
  role: Role;
  tenantId?: string;
  tenantRoles?: Role[]; // roles inside tenant
  avatarUrl?: string | null;
}

export interface AppShellProps {
  tenantId: string;
  userRole: Role;
  onLogout: () => void;
  children?: React.ReactNode;
}

export interface KpiCardProps {
  title: string;
  value: string | number;
  delta?: number; // percentage or absolute delta
  trend?: 'up' | 'down' | 'flat';
  ariaLabel?: string;
}

export interface ActivityItem {
  id: string;
  eventType: string;
  summary: string;
  createdAt: string; // ISO
  payload?: Record<string, unknown>;
}

export interface ActivityFeedProps {
  items: ActivityItem[];
  onClick?: (item: ActivityItem) => void;
}

/**
 * BookingEvent - canonical booking/event shape used by Calendar and Table
 */
export interface BookingEvent {
  id: string;
  tenantId?: string;
  locationId?: string;
  serviceId?: string;
  start: string; // ISO timestamp
  end: string; // ISO timestamp
  status: BookingStatus;
  serviceName?: string;
  staffId?: string;
  customer: {
    id: string;
    name?: string;
    phone?: string;
    email?: string;
  };
  metadata?: Record<string, any>;
}

/** Calendar component props */
export interface CalendarProps {
  view: ViewMode;
  events: BookingEvent[];
  staffLanes?: boolean;
  timezone?: string;
  onEventClick?: (event: BookingEvent) => void;
  onEventDrop?: (
    eventId: string,
    newStart: string,
    newEnd: string,
    newStaffId?: string
  ) => Promise<void>;
  onRangeChange?: (start: string, end: string) => void;
}

/** Bookings Table / List view */
export interface BookingsTableProps {
  bookings: BookingEvent[];
  columns?: string[]; // keys: 'start','customer','service','staff','status'
  selectable?: boolean;
  onRowClick?: (booking: BookingEvent) => void;
  onBulkAction?: (action: string, ids: string[]) => Promise<void>;
}

/** BookingComposer (chat-first micro-flow) */
export interface ComposerContext {
  prefill?: Partial<BookingEvent>;
  customerId?: string;
  tenantId: string;
  locationId?: string;
}

export interface BookingComposerProps {
  context: ComposerContext;
  onComplete: (booking: BookingEvent) => void;
  onCancel?: () => void;
  uiConfig?: { primaryColor?: string; compact?: boolean };
}

/** BookingSidePanel (detail + chat + actions) */
export interface BookingSidePanelProps {
  booking: BookingEvent;
  onClose: () => void;
  onUpdate: (patch: Partial<BookingEvent>) => Promise<void>;
  onAction: (
    action: 'confirm' | 'cancel' | 'reschedule' | 'mark_paid',
    payload?: Record<string, unknown>
  ) => Promise<void>;
}

/** Chat/message types */
export type Channel = 'whatsapp' | 'email' | 'sms' | 'app';

export type MessageDirection = 'inbound' | 'outbound';

export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'failed';

export interface Message {
  id: string;
  bookingId?: string;
  direction: MessageDirection;
  channel: Channel;
  text: string;
  status?: MessageStatus;
  createdAt: string; // ISO
  metadata?: Record<string, unknown>;
}

export interface ChatThreadProps {
  messages: Message[];
  customerId?: string;
  bookingId?: string;
  onSend: (m: { text: string; attachments?: File[]; metadata?: Record<string, unknown> }) => Promise<Message>;
  onAction?: (action: string, payload?: Record<string, unknown>) => Promise<void>;
}

export interface ChatComposerProps {
  placeholder?: string;
  quickReplies?: string[];
  onSend: ChatThreadProps['onSend'];
}

/** Client profile */
export interface ClientProfile {
  id: string;
  name?: string;
  phone?: string;
  email?: string;
  metadata?: Record<string, any>;
  consent?: { channel: Channel; optedIn: boolean; timestamp?: string }[];
}

export interface ClientProfileProps {
  client: ClientProfile;
  onUpdate?: (patch: Partial<ClientProfile>) => Promise<void>;
}

/** Staff shapes */
export interface StaffAvailability {
  day: number; // 0 = Sunday ... 6 = Saturday
  start: string; // "09:00"
  end: string; // "17:00"
}

export interface Staff {
  id: string;
  name: string;
  role: string;
  skills?: string[];
  avatarUrl?: string | null;
  availability?: StaffAvailability[];
}

export interface StaffListProps {
  staff: Staff[];
  onEdit?: (s: Staff) => void;
}

export interface StaffCardProps {
  staff: Staff;
  metrics?: { bookingsPerWeek?: number; utilizationPct?: number };
  onAssign?: (bookingId: string) => void;
}

/** API response helper shapes */
export interface Paginated<T> {
  items: T[];
  total: number;
  page?: number;
  limit?: number;
}

/** Auth me response */
export interface AuthMeResponse {
  userId: string;
  name: string;
  email?: string;
  role: Role;
  tenantId?: string;
  tenantRoles?: Role[];
}

/** Tenant settings & module config */
export interface TenantConfig {
  tenantId: string;
  modules?: Record<string, { installed: boolean; version?: string; config?: any }>;
  templates?: Record<string, string>;
  forms?: Record<string, any>; // JSON Schemas per form
  featureFlags?: Record<string, boolean>;
}

/** Payment link response */
export interface PaymentLinkResponse {
  paymentId: string;
  link: string;
  expiresAt?: string;
}

/** Generic API error */
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
