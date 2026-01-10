-- Migration: create reservation_logs table
-- Path: supabase/migrations/007_create_reservation_logs.sql

CREATE TABLE IF NOT EXISTS reservation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid REFERENCES reservations(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  action text NOT NULL,
  actor jsonb DEFAULT '{}'::jsonb,
  notes text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reservation_logs_reservation_id ON reservation_logs (reservation_id);
CREATE INDEX IF NOT EXISTS idx_reservation_logs_tenant_id ON reservation_logs (tenant_id);
