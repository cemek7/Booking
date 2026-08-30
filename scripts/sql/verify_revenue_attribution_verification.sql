do $$
declare
  missing_columns text[];
begin
  select array_agg(required.name order by required.name)
  into missing_columns
  from (values
    ('attribution_type'),
    ('verification_status'),
    ('amount_cents'),
    ('currency'),
    ('evidence_type'),
    ('verified_at'),
    ('verified_by'),
    ('attribution_window_started_at')
  ) as required(name)
  where not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'sias_outcome_attributions'
      and column_name = required.name
  );

  if missing_columns is not null then
    raise exception 'sias_outcome_attributions missing columns: %', missing_columns;
  end if;

  if exists (
    select 1
    from public.sias_outcome_attributions
    where amount_cents < 0
  ) then
    raise exception 'negative amount_cents found';
  end if;
end $$;
