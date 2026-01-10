DB migrations and seeds for Booka

Usage (local Postgres)

1) Ensure you have a Postgres database available and have set the connection environment variables (e.g., DATABASE_URL or PGHOST/PGUSER/PGPASSWORD/PGDATABASE).

2) Run migration SQL (example using psql with DATABASE_URL):

   # from project root (PowerShell)
   psql $env:DATABASE_URL -f db/migrations/0001_init.sql

3) Seed sample data:

   psql $env:DATABASE_URL -f db/seeds/seed_sample.sql

Notes
- The migration uses simple TEXT keys for IDs to keep the SQL portable and avoid requiring extensions.
- For production, consider switching to UUIDs and enabling pgcrypto/uuid-ossp as needed.
