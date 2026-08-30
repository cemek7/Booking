begin;

create table if not exists public.booka_revenue_requests (
  id uuid primary key default gen_random_uuid(),
  request_type text not null check (request_type in ('revenue_pilot', 'missed_revenue_report')),
  business_name text not null,
  contact_name text not null,
  email text not null,
  phone text not null,
  vertical text not null check (vertical in ('beauty', 'hospitality', 'clinic', 'other')),
  other_vertical text,
  weekly_enquiry_band text not null check (weekly_enquiry_band in ('under_20', '20_49', '50_99', '100_249', '250_plus')),
  channels text[] not null default '{}',
  average_transaction_value_ngn numeric(14,2),
  current_conversion_band text check (current_conversion_band in ('unknown', 'under_10', '10_24', '25_49', '50_plus')),
  instagram_handle text,
  website_url text,
  consent_to_contact boolean not null,
  sample_review_consent boolean not null default false,
  status text not null default 'new' check (status in ('new', 'qualified', 'contacted', 'audit_in_progress', 'audit_ready', 'pilot_scheduled', 'converted', 'closed')),
  qualification_note text,
  audit_summary jsonb not null default '{}'::jsonb,
  source text not null default 'booka_website',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(channels) > 0),
  check (consent_to_contact = true),
  check (vertical <> 'other' or nullif(trim(other_vertical), '') is not null)
);

create index if not exists idx_booka_revenue_requests_status_created
  on public.booka_revenue_requests (status, created_at desc);

create index if not exists idx_booka_revenue_requests_type_created
  on public.booka_revenue_requests (request_type, created_at desc);

create unique index if not exists idx_booka_revenue_requests_open_contact
  on public.booka_revenue_requests (request_type, lower(email))
  where status not in ('converted', 'closed');

alter table public.booka_revenue_requests enable row level security;
revoke all on public.booka_revenue_requests from anon, authenticated;
grant all on public.booka_revenue_requests to service_role;

drop policy if exists booka_revenue_requests_service_role on public.booka_revenue_requests;
create policy booka_revenue_requests_service_role
  on public.booka_revenue_requests for all to service_role
  using (true) with check (true);

commit;
