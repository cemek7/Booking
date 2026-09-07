-- Migration 123: explicit revenue attribution and verification fields.
-- Legacy `value` remains untouched because it may represent a count, score, or lift.
begin;

alter table public.sias_outcome_attributions
  add column if not exists attribution_type text,
  add column if not exists verification_status text not null default 'unverified',
  add column if not exists amount_cents bigint,
  add column if not exists currency text,
  add column if not exists evidence_type text,
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by uuid,
  add column if not exists attribution_window_started_at timestamptz;

alter table public.sias_outcome_attributions
  drop constraint if exists sias_outcome_attributions_type_check,
  drop constraint if exists sias_outcome_attributions_verification_check,
  drop constraint if exists sias_outcome_attributions_amount_check,
  drop constraint if exists sias_outcome_attributions_currency_check;

alter table public.sias_outcome_attributions
  add constraint sias_outcome_attributions_type_check
    check (
      attribution_type is null
      or attribution_type in ('processed', 'influenced', 'recovered')
    ),
  add constraint sias_outcome_attributions_verification_check
    check (
      verification_status in ('unverified', 'merchant_confirmed', 'system_verified', 'rejected')
    ),
  add constraint sias_outcome_attributions_amount_check
    check (amount_cents is null or amount_cents >= 0),
  add constraint sias_outcome_attributions_currency_check
    check (currency is null or currency ~ '^[A-Z]{3}$');

update public.sias_outcome_attributions
set attribution_type = case
  when signal = 'revenue_recovery' then 'recovered'
  when signal in ('upsell_conversion', 'repeat_booking_lift', 'reactivation_lift') then 'influenced'
  else null
end
where attribution_type is null;

create index if not exists idx_sias_attribution_tenant_type_verified
  on public.sias_outcome_attributions
  (tenant_id, attribution_type, verification_status, created_at desc);

commit;
