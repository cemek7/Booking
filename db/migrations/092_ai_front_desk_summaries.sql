-- AI Front Desk Summary Tables
-- Stage B: precomputed intelligence for owner queries and faster grounding

CREATE TABLE IF NOT EXISTS tenant_daily_summary (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  date date NOT NULL,
  bookings_count integer NOT NULL DEFAULT 0,
  completed_count integer NOT NULL DEFAULT 0,
  cancelled_count integer NOT NULL DEFAULT 0,
  no_show_count integer NOT NULL DEFAULT 0,
  estimated_revenue numeric(12,2) NOT NULL DEFAULT 0,
  top_service text,
  top_staff text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, date)
);

CREATE INDEX IF NOT EXISTS tenant_daily_summary_tenant_date_idx
  ON tenant_daily_summary (tenant_id, date DESC);

CREATE TABLE IF NOT EXISTS customer_profile_summary (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  lifetime_bookings integer NOT NULL DEFAULT 0,
  last_visit timestamptz,
  favorite_service text,
  favorite_staff text,
  days_since_visit integer,
  risk_score text NOT NULL DEFAULT 'low',
  generated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, customer_id)
);

CREATE INDEX IF NOT EXISTS customer_profile_summary_tenant_risk_idx
  ON customer_profile_summary (tenant_id, risk_score, days_since_visit DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS service_performance_summary (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  service_id uuid NOT NULL,
  bookings integer NOT NULL DEFAULT 0,
  revenue numeric(12,2) NOT NULL DEFAULT 0,
  cancellations integer NOT NULL DEFAULT 0,
  completion_rate numeric(6,4) NOT NULL DEFAULT 0,
  generated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, service_id)
);

CREATE INDEX IF NOT EXISTS service_performance_summary_tenant_bookings_idx
  ON service_performance_summary (tenant_id, bookings DESC, revenue DESC);

CREATE TABLE IF NOT EXISTS staff_performance_summary (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL,
  bookings integer NOT NULL DEFAULT 0,
  completion_rate numeric(6,4) NOT NULL DEFAULT 0,
  estimated_revenue numeric(12,2) NOT NULL DEFAULT 0,
  generated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, staff_id)
);

CREATE INDEX IF NOT EXISTS staff_performance_summary_tenant_bookings_idx
  ON staff_performance_summary (tenant_id, bookings DESC, estimated_revenue DESC);

CREATE TABLE IF NOT EXISTS availability_snapshot (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL,
  service_id uuid NOT NULL,
  date date NOT NULL,
  available_slots jsonb NOT NULL DEFAULT '[]'::jsonb,
  generated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, staff_id, service_id, date)
);

CREATE INDEX IF NOT EXISTS availability_snapshot_tenant_date_idx
  ON availability_snapshot (tenant_id, date, staff_id, service_id);
