-- Rollback for migration 150.
-- Destructive: drops every inquiry ever received. Export before running.
DROP TABLE IF EXISTS public.platform_inquiries;
