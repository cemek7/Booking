import { z } from 'zod';

export const bookingCreateSchema = z.object({
  customerId: z.string().optional(),
  customerName: z.string().min(1, 'Customer name required').optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  serviceId: z.string().min(1, 'Service is required'),
  staffId: z.string().optional(),
  start: z.string().min(1, 'Start required'),
  end: z.string().min(1, 'End required'),
  metadata: z.record(z.any()).optional(),
});

export const bookingActionSchema = z.object({
  action: z.enum(['confirm','cancel','reschedule','mark_paid']),
  payload: z.any().optional(),
});

export const messageSendSchema = z.object({
  channel: z.enum(['whatsapp','email','sms','app']),
  text: z.string().min(1, 'Message required'),
  attachments: z.array(z.any()).optional(),
});

export const tenantsListQuerySchema = z.object({
  status: z.string().optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(10),
});

export type BookingCreate = z.infer<typeof bookingCreateSchema>;
export type BookingAction = z.infer<typeof bookingActionSchema>;
export type MessageSend = z.infer<typeof messageSendSchema>;