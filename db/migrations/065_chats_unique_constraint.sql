-- Migration 065: Add missing unique constraint on chats(tenant_id, customer_phone)
-- Migration 064 used CREATE TABLE IF NOT EXISTS so the UNIQUE clause was skipped
-- for any project where the chats table already existed.

-- Clean up any duplicate chat rows before adding the constraint
-- (keeps the oldest row per tenant+phone pair)
DELETE FROM public.chats
WHERE id NOT IN (
  SELECT DISTINCT ON (tenant_id, customer_phone) id
  FROM public.chats
  ORDER BY tenant_id, customer_phone, created_at ASC
);

-- Now add the constraint (idempotent)
ALTER TABLE public.chats
  DROP CONSTRAINT IF EXISTS chats_tenant_phone_unique;

ALTER TABLE public.chats
  ADD CONSTRAINT chats_tenant_phone_unique UNIQUE (tenant_id, customer_phone);
