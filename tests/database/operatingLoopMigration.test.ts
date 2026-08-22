import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(__dirname, '../../supabase/migrations/042_operating_loop.sql');

function migrationSql() {
  return readFileSync(migrationPath, 'utf8').replace(/\s+/g, ' ').toLowerCase();
}

describe('042 operating-loop migration contract', () => {
  it('creates tenant-owned UUID records with the required operational evidence', () => {
    const sql = migrationSql();

    for (const table of [
      'operating_loop_state',
      'operating_objectives',
      'operating_actions',
      'automation_policies',
      'onboarding_evidence',
    ]) {
      expect(sql).toMatch(new RegExp(`create table if not exists public\\.${table} \\(`));
      expect(sql).toMatch(new RegExp(`create table if not exists public\\.${table} \\([^;]*id uuid primary key`));
      expect(sql).toMatch(new RegExp(`create table if not exists public\\.${table} \\([^;]*tenant_id uuid not null references public\\.tenants\\(id\\) on delete cascade`));
      expect(sql).toMatch(new RegExp(`create table if not exists public\\.${table} \\([^;]*created_at timestamptz not null default now\\(\\)`));
    }

    expect(sql).toMatch(/operating_loop_state \([^;]*supporting_signals jsonb not null default '\[\]'::jsonb/);
    expect(sql).toMatch(/operating_objectives \([^;]*evidence jsonb not null default '\{\}'::jsonb/);
    expect(sql).toMatch(/operating_objectives \([^;]*affected_record_ids jsonb not null default '\[\]'::jsonb/);
    expect(sql).toMatch(/operating_actions \([^;]*proposed_payload jsonb not null default '\{\}'::jsonb/);
    expect(sql).toMatch(/operating_actions \([^;]*result_payload jsonb not null default '\{\}'::jsonb/);
    expect(sql).toMatch(/automation_policies \([^;]*eligibility_rules jsonb not null default '\{\}'::jsonb/);
    expect(sql).toMatch(/automation_policies \([^;]*quiet_hours jsonb not null default '\{\}'::jsonb/);
    expect(sql).toMatch(/onboarding_evidence \([^;]*extracted_fields jsonb not null default '\{\}'::jsonb/);
    expect(sql).toMatch(/onboarding_evidence \([^;]*owner_edits jsonb not null default '\{\}'::jsonb/);
  });

  it('enforces status bounds and preserves active-objective deduplication', () => {
    const sql = migrationSql();

    for (const constraint of [
      'operating_loop_state_state_check',
      'operating_objectives_status_check',
      'operating_actions_status_check',
      'automation_policies_status_check',
      'onboarding_evidence_approval_status_check',
    ]) {
      expect(sql).toContain(`constraint ${constraint} check`);
    }

    expect(sql).toMatch(/create unique index if not exists operating_objectives_active_dedupe_idx on public\.operating_objectives \(tenant_id, dedupe_key\) where status = 'active'/);
    expect(sql).toContain('create index if not exists operating_loop_state_tenant_day_idx');
    expect(sql).toContain('create index if not exists operating_objectives_tenant_status_idx');
    expect(sql).toContain('create index if not exists operating_actions_tenant_created_idx');
    expect(sql).toContain('create index if not exists automation_policies_tenant_status_idx');
    expect(sql).toContain('create index if not exists onboarding_evidence_tenant_status_idx');
  });

  it('enables tenant reads, owner-only writes, and service-worker access', () => {
    const sql = migrationSql();

    for (const table of [
      'operating_loop_state',
      'operating_objectives',
      'operating_actions',
      'automation_policies',
      'onboarding_evidence',
    ]) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toMatch(new RegExp(`create policy ${table}_tenant_read on public\\.${table} for select to authenticated`));
      expect(sql).toMatch(new RegExp(`create policy ${table}_service_access on public\\.${table} for all to service_role using \\(true\\) with check \\(true\\)`));
    }

    expect(sql).toMatch(/create policy operating_actions_owner_insert on public\.operating_actions for insert to authenticated with check \(/);
    expect(sql).toMatch(/create policy automation_policies_owner_manage on public\.automation_policies for all to authenticated using \([\s\S]*with check \(/);
    expect(sql).toMatch(/create policy onboarding_evidence_owner_manage on public\.onboarding_evidence for all to authenticated using \([\s\S]*with check \(/);
    expect(sql).toContain('revoke update, delete on table public.operating_actions from authenticated');
  });
});
