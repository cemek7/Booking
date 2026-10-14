-- Secure, single-use tenant account invitations.
-- Raw invitation tokens never enter the database.

begin;

create table if not exists public.tenant_invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and email <> ''),
  role text not null check (role in ('manager', 'staff')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by uuid not null references auth.users(id),
  accepted_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  check (expires_at > created_at),
  check (
    (accepted_at is null and accepted_by is null)
    or (accepted_at is not null and accepted_by is not null)
  )
);

create index if not exists tenant_invitations_token_hash_idx
  on public.tenant_invitations (token_hash);

create index if not exists tenant_invitations_tenant_email_idx
  on public.tenant_invitations (tenant_id, email, created_at desc);

create unique index if not exists tenant_invitations_one_pending_idx
  on public.tenant_invitations (tenant_id, email)
  where accepted_at is null and revoked_at is null;

alter table public.tenant_invitations enable row level security;
alter table public.tenant_invitations force row level security;

revoke all on table public.tenant_invitations from public, anon, authenticated;
grant select, insert, update, delete on table public.tenant_invitations to service_role;

create or replace function public.accept_tenant_invitation(
  p_token_hash text,
  p_user_id uuid,
  p_user_email text
)
returns table (
  tenant_id uuid,
  role text,
  invitation_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_invitation public.tenant_invitations%rowtype;
  v_member public.tenant_users%rowtype;
  v_email text := lower(btrim(p_user_email));
begin
  if p_token_hash is null
     or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_user_id is null
     or v_email is null
     or v_email = '' then
    raise exception using errcode = 'P0001', message = 'invite_invalid';
  end if;

  select invitation.*
    into v_invitation
    from public.tenant_invitations as invitation
   where invitation.token_hash = p_token_hash
   for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'invite_invalid';
  end if;

  if v_invitation.revoked_at is not null then
    raise exception using errcode = 'P0001', message = 'invite_invalid';
  end if;

  if v_invitation.accepted_at is not null then
    raise exception using errcode = 'P0001', message = 'invite_consumed';
  end if;

  if v_invitation.expires_at <= now() then
    raise exception using errcode = 'P0001', message = 'invite_expired';
  end if;

  if v_invitation.role not in ('manager', 'staff') then
    raise exception using errcode = 'P0001', message = 'invite_invalid';
  end if;

  if v_invitation.email <> v_email then
    raise exception using errcode = 'P0001', message = 'invite_email_mismatch';
  end if;

  select member.*
    into v_member
    from public.tenant_users as member
   where member.tenant_id = v_invitation.tenant_id
     and member.user_id is not null
     and (
       member.user_id = p_user_id
       or lower(btrim(member.email)) = v_email
     )
   limit 1
   for update;

  if found then
    raise exception using errcode = 'P0001', message = 'invite_membership_conflict';
  end if;

  select member.*
    into v_member
    from public.tenant_users as member
   where member.tenant_id = v_invitation.tenant_id
     and member.user_id is null
     and lower(btrim(member.email)) = v_email
   order by member.created_at asc
   limit 1
   for update;

  if found then
    update public.tenant_users as member
       set user_id = p_user_id,
           email = v_email,
           role = v_invitation.role
     where member.id = v_member.id;
  else
    insert into public.tenant_users (tenant_id, user_id, email, role)
    values (
      v_invitation.tenant_id,
      p_user_id,
      v_email,
      v_invitation.role
    );
  end if;

  update public.tenant_invitations as invitation
     set accepted_at = now(),
         accepted_by = p_user_id
   where invitation.id = v_invitation.id;

  return query
  select v_invitation.tenant_id, v_invitation.role, v_invitation.id;
end;
$$;

revoke execute on function public.accept_tenant_invitation(text, uuid, text) from public;
revoke execute on function public.accept_tenant_invitation(text, uuid, text) from anon;
revoke execute on function public.accept_tenant_invitation(text, uuid, text) from authenticated;
grant execute on function public.accept_tenant_invitation(text, uuid, text) to service_role;

commit;
