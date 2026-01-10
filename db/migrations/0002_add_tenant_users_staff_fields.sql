-- Add staff_type and status to tenant_users
ALTER TABLE public.tenant_users
  ADD COLUMN IF NOT EXISTS staff_type text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','on_leave'));

-- Optional: backfill status to 'active' where null (for older rows if constraint added separately)
UPDATE public.tenant_users SET status = 'active' WHERE status IS NULL;
