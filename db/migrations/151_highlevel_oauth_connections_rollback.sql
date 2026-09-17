-- Rollback for migration 151.
-- Destructive: drops every stored GoHighLevel installation. Re-authorization is
-- required after running this.
DROP TABLE IF EXISTS public.highlevel_oauth_connections;
DROP TABLE IF EXISTS public.highlevel_oauth_states;
