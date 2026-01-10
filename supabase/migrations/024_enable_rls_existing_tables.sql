-- Enable RLS for existing tables missing explicit enable statements
-- Date: 2025-11-20
alter table if exists platform_settings enable row level security;
alter table if exists skills enable row level security;
alter table if exists staff_skills enable row level security;
alter table if exists tenant_users enable row level security;
alter table if exists tenants enable row level security;
alter table if exists transactions enable row level security;
alter table if exists users enable row level security;

create policy if not exists messages_select on messages for select using (true);
create policy if not exists platform_settings_select on platform_settings for select using (true);
create policy if not exists skills_select on skills for select using (true);
create policy if not exists staff_skills_select on staff_skills for select using (true);
create policy if not exists tenant_users_select on tenant_users for select using (true);
create policy if not exists tenants_select on tenants for select using (true);
create policy if not exists transactions_select on transactions for select using (true);
create policy if not exists users_select on users for select using (true);

alter table if exists messages enable row level security;
alter table if exists platform_settings enable row level security;
alter table if exists skills enable row level security;
alter table if exists staff_skills enable row level security;
alter table if exists tenant_users enable row level security;
alter table if exists tenants enable row level security;
alter table if exists transactions enable row level security;
alter table if exists users enable row level security;
alter table if exists reservation_logs enable row level security;
alter table if exists reservations enable row level security;

-- Basic read policies (refine later with tenant scoping)
create policy if not exists messages_select on messages for select using (true);
create policy if not exists platform_settings_select on platform_settings for select using (true);
create policy if not exists skills_select on skills for select using (true);
create policy if not exists staff_skills_select on staff_skills for select using (true);
create policy if not exists tenant_users_select on tenant_users for select using (true);
create policy if not exists tenants_select on tenants for select using (true);
create policy if not exists transactions_select on transactions for select using (true);
create policy if not exists users_select on users for select using (true);
create policy if not exists reservation_logs_select on reservation_logs for select using (true);
create policy if not exists reservations_select on reservations for select using (true);