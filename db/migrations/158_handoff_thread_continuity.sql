-- Preserve the exact canonical conversation through escalation and takeover.
BEGIN;

ALTER TABLE public.escalation_queue
  ADD COLUMN IF NOT EXISTS conversation_thread_id uuid
    REFERENCES public.conversation_threads(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_escalation_queue_thread_open
  ON public.escalation_queue (tenant_id, conversation_thread_id, created_at DESC)
  WHERE status IN ('pending', 'claimed');

COMMIT;
