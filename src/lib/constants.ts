/**
 * Centralized constants for the Boka application.
 * Use these instead of hardcoded values throughout the codebase.
 */

// PostgreSQL error codes
export const PG_ERROR_CODES = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  NOT_NULL_VIOLATION: '23502',
  CHECK_VIOLATION: '23514',
} as const;

// Pagination defaults
export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
  MIN_LIMIT: 1,
} as const;

// Analytics time ranges
export const TIME_RANGES = {
  DEFAULT_DAYS: 30,
  WEEK: 7,
  MONTH: 30,
  QUARTER: 90,
  YEAR: 365,
} as const;

// Cache TTL values (in seconds)
export const CACHE_TTL = {
  SHORT: 60,           // 1 minute
  MEDIUM: 300,         // 5 minutes
  LONG: 3600,          // 1 hour
  VERY_LONG: 86400,    // 24 hours
} as const;

// HTTP status codes for reference
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

// Rate limiting defaults
export const RATE_LIMITS = {
  DEFAULT_REQUESTS_PER_MINUTE: 60,
  WEBHOOK_REQUESTS_PER_MINUTE: 100,
  AUTH_REQUESTS_PER_MINUTE: 10,
} as const;

// Webhook providers
export const WEBHOOK_PROVIDERS = {
  STRIPE: 'stripe',
  PAYSTACK: 'paystack',
  EVOLUTION: 'evolution',
  TWILIO: 'twilio',
} as const;

// Role hierarchy levels (lower number = higher privilege)
export const ROLE_LEVELS = {
  SUPERADMIN: 0,
  OWNER: 1,
  MANAGER: 2,
  STAFF: 3,
} as const;

// Booking status values
export const BOOKING_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
  NO_SHOW: 'no_show',
} as const;

// Payment status values
export const PAYMENT_STATUS = {
  PENDING: 'pending',
  SUCCESS: 'success',
  FAILED: 'failed',
  REFUNDED: 'refunded',
  PARTIALLY_REFUNDED: 'partially_refunded',
} as const;

// Message types
export const MESSAGE_TYPES = {
  TEXT: 'text',
  IMAGE: 'image',
  VIDEO: 'video',
  AUDIO: 'audio',
  DOCUMENT: 'document',
  BUTTON_REPLY: 'button_reply',
  LIST_REPLY: 'list_reply',
} as const;

// Type exports for TypeScript
export type PgErrorCode = typeof PG_ERROR_CODES[keyof typeof PG_ERROR_CODES];
export type BookingStatus = typeof BOOKING_STATUS[keyof typeof BOOKING_STATUS];
export type PaymentStatus = typeof PAYMENT_STATUS[keyof typeof PAYMENT_STATUS];
export type MessageType = typeof MESSAGE_TYPES[keyof typeof MESSAGE_TYPES];
export type WebhookProvider = typeof WEBHOOK_PROVIDERS[keyof typeof WEBHOOK_PROVIDERS];
