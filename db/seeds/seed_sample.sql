-- seed_sample.sql
-- Inserts a sample tenant, user, and a couple reservations to help local development

INSERT INTO tenants (id, name) VALUES ('tenant-sample', 'Sample Beauty Shop')
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, tenant_id, email, user_metadata)
VALUES ('user-sample', 'tenant-sample', 'owner@sample.test', '{"role":"owner"}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO reservations (id, tenant_id, customer_name, phone, service, start_at, end_at, duration_minutes, status)
VALUES
  ('r-sample-1', 'tenant-sample', 'Alice', '08010000001', 'Haircut', now() + INTERVAL '1 day', now() + INTERVAL '1 day' + INTERVAL '1 hour', 60, 'confirmed'),
  ('r-sample-2', 'tenant-sample', 'Bob', '08010000002', 'Massage', now() + INTERVAL '2 days', now() + INTERVAL '2 days' + INTERVAL '1 hour', 60, 'pending')
ON CONFLICT (id) DO NOTHING;
