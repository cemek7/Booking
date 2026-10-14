-- Owner-run verification for migration 161.
-- The script is read-only and always rolls back.

begin;

do $$
declare
  v_function regprocedure :=
    to_regprocedure('public.accept_tenant_invitation(text,uuid,text)');
begin
  if to_regclass('public.tenant_invitations') is null then
    raise exception 'migration 161 verification failed: table missing';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_class as relation
     where relation.oid = 'public.tenant_invitations'::regclass
       and relation.relrowsecurity
       and relation.relforcerowsecurity
  ) then
    raise exception 'migration 161 verification failed: RLS is not enabled and forced';
  end if;

  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'tenant_invitations'
       and column_name = 'token'
  ) then
    raise exception 'migration 161 verification failed: raw token column exists';
  end if;

  if (
    select count(*)
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'tenant_invitations'
       and column_name in (
         'id', 'tenant_id', 'email', 'role', 'token_hash', 'invited_by',
         'accepted_by', 'created_at', 'expires_at', 'accepted_at', 'revoked_at'
       )
  ) <> 11 then
    raise exception 'migration 161 verification failed: required columns missing';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_indexes
     where schemaname = 'public'
       and tablename = 'tenant_invitations'
       and indexname = 'tenant_invitations_one_pending_idx'
       and indexdef ilike '%where ((accepted_at is null) and (revoked_at is null))%'
  ) then
    raise exception 'migration 161 verification failed: pending invitation index missing';
  end if;

  if v_function is null then
    raise exception 'migration 161 verification failed: acceptance function missing';
  end if;

  if exists (
    select 1
      from pg_catalog.pg_proc
     where oid = v_function
       and prosecdef
  ) then
    raise exception 'migration 161 verification failed: function must be security invoker';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_proc
     where oid = v_function
       and coalesce(proconfig, '{}'::text[]) @> array['search_path=""']::text[]
  ) then
    raise exception 'migration 161 verification failed: function search_path is not empty';
  end if;

  if has_function_privilege('public', v_function, 'EXECUTE')
     or has_function_privilege('anon', v_function, 'EXECUTE')
     or has_function_privilege('authenticated', v_function, 'EXECUTE') then
    raise exception 'migration 161 verification failed: browser role can execute function';
  end if;

  if not has_function_privilege('service_role', v_function, 'EXECUTE') then
    raise exception 'migration 161 verification failed: service_role cannot execute function';
  end if;

  if has_table_privilege('anon', 'public.tenant_invitations', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'public.tenant_invitations', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'migration 161 verification failed: browser role has table privileges';
  end if;

  if not has_table_privilege(
    'service_role',
    'public.tenant_invitations',
    'SELECT,INSERT,UPDATE,DELETE'
  ) then
    raise exception 'migration 161 verification failed: service_role table privileges missing';
  end if;
end;
$$;

rollback;
