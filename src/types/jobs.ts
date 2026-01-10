// Shared types for jobs, messages and worker payloads
export type JobPayload = {
  message_id?: string | null;
  tenant_id?: string | null;
  // allow arbitrary payload extension
  [k: string]: unknown;
  // optional recurring metadata used by the worker runner to reschedule
  _recurring?: {
    // interval in minutes between runs; if present the worker will insert a new pending job
    interval_minutes?: number;
  } | null;
};

export type JobRow = {
  id: string;
  type: string;
  payload: JobPayload | null;
  attempts: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  scheduled_at: string;
  last_error?: string | null;
  created_at: string;
  updated_at: string;
};

export type MessageRow = {
  id: string;
  tenant_id?: string | null;
  reservation_id?: string | null;
  from_number?: string | null;
  to_number?: string | null;
  content?: string | null;
  direction?: 'inbound' | 'outbound';
  raw?: unknown;
  created_at?: string;
};

export type JobInsertRow = Omit<JobRow, 'id' | 'created_at' | 'updated_at'> & { payload?: JobPayload | null };
