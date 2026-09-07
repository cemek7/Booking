do $$
declare
  missing_columns text[];
begin
  select array_agg(required.name)
  into missing_columns
  from (values
    ('request_type'), ('business_name'), ('contact_name'), ('email'), ('phone'),
    ('vertical'), ('weekly_enquiry_band'), ('channels'), ('consent_to_contact'),
    ('sample_review_consent'), ('status'), ('audit_summary'), ('created_at'), ('updated_at')
  ) as required(name)
  where not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'booka_revenue_requests'
      and column_name = required.name
  );

  if missing_columns is not null then
    raise exception 'booka_revenue_requests missing columns: %', missing_columns;
  end if;

  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'booka_revenue_requests'
      and c.relrowsecurity
  ) then
    raise exception 'RLS is not enabled on booka_revenue_requests';
  end if;
end $$;
