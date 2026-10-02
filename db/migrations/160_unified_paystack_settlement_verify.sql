-- Verifier for migration 160. Read-only. Every row must report ok = true.
SELECT 'payment_fee_policies exists' AS check_name,
       to_regclass('public.payment_fee_policies') IS NOT NULL AS ok
UNION ALL SELECT 'tenant_payment_accounts exists', to_regclass('public.tenant_payment_accounts') IS NOT NULL
UNION ALL SELECT 'pilot policy seeded', EXISTS (
  SELECT 1 FROM public.payment_fee_policies
  WHERE code = 'pilot_ngn_v1' AND version = 1 AND platform_fee_basis_points = 100
    AND platform_fee_cap_minor = 200000 AND fee_bearer = 'subaccount')
UNION ALL SELECT 'transactions snapshot columns', (
  SELECT count(*) = 13 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'transactions'
    AND column_name IN ('amount_minor','platform_fee_minor','tenant_gross_minor',
      'settlement_subaccount_code','settlement_fee_bearer','settlement_policy_code',
      'settlement_policy_version','settlement_idempotency_key','provider_amount_minor',
      'provider_currency','provider_fee_minor','provider_subaccount_code',
      'settlement_verification_status'))
UNION ALL SELECT 'RLS on accounts', (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.tenant_payment_accounts'::regclass)
UNION ALL SELECT 'RLS on policies', (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.payment_fee_policies'::regclass)
UNION ALL SELECT 'no anon grants on accounts', NOT has_table_privilege('anon', 'public.tenant_payment_accounts', 'SELECT')
UNION ALL SELECT 'authenticated cannot write accounts', NOT has_table_privilege('authenticated', 'public.tenant_payment_accounts', 'INSERT,UPDATE,DELETE')
UNION ALL SELECT 'revenue type accepts platform fee', EXISTS (
  SELECT 1 FROM pg_constraint WHERE conrelid = 'public.tenant_revenue_ledger'::regclass
    AND pg_get_constraintdef(oid) LIKE '%platform_transaction_fee%')
UNION ALL SELECT 'escalation accepts payment_settlement', EXISTS (
  SELECT 1 FROM pg_constraint WHERE conname = 'escalation_queue_reason_code_check'
    AND pg_get_constraintdef(oid) LIKE '%payment_settlement%')
UNION ALL SELECT 'zero tenant subaccounts in metadata', NOT EXISTS (
  SELECT 1 FROM public.tenants WHERE metadata ? 'paystack_subaccount_code');
