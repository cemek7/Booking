# VPS deployment

This scaffold standardizes Booka around:

- `techclave.cloud` for marketing
- `app.techclave.cloud` for production SaaS
- `staging.app.techclave.cloud` for staging SaaS
- `mail.techclave.cloud` for transactional email
- `news.techclave.cloud` for marketing email

## What is automated

- Hostinger VPS package bootstrap
- Docker + Docker Compose setup
- Nginx site creation for staging and production
- Stack directories under `/opt/techclave`
- Environment file seeding
- GHCR-based deploy script installation
- Cron generation for Booka scheduled routes

## What stays manual

- DNS creation in Hostinger
- Supabase redirect URL registration
- Resend domain verification
- GitHub environment secrets

Those provider steps are still explicit because there is no repo-local way to safely apply them without provider credentials.

## 1. Bootstrap the VPS

Run as `root` on the VPS after cloning this repository:

```bash
bash deployment/scripts/bootstrap-vps.sh \
  --deploy-user deploy \
  --app-domain app.techclave.cloud \
  --staging-domain staging.app.techclave.cloud \
  --email ops@techclave.cloud
```

That will:

- install Docker, Nginx, Certbot, and UFW
- create `/opt/techclave/prod` and `/opt/techclave/staging`
- seed `.env` files from the examples
- install `/usr/local/bin/techclave-deploy`
- create Nginx vhosts for staging and production

If DNS is already pointed, rerun with:

```bash
RUN_CERTBOT=true bash deployment/scripts/bootstrap-vps.sh ...
```

## 2. Fill environment files

Edit:

- `/opt/techclave/prod/.env`
- `/opt/techclave/staging/.env`

Important values:

- `APP_IMAGE`
- `APP_URL`
- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_BASE_URL`
- `SUPABASE_*`
- `DATABASE_URL`
- `REDIS_PASSWORD`
- `CRON_SECRET`
- `RESEND_API_KEY`

## 3. DNS records

Create these in Hostinger:

- `@`
- `www`
- `app`
- `staging.app`
- `mail`
- `news`
- later: `docs`, `status`, `api`

Point:

- `app.techclave.cloud` -> VPS public IP
- `staging.app.techclave.cloud` -> VPS public IP

Use Resend-provided DNS records for:

- `mail.techclave.cloud`
- `news.techclave.cloud`

## 4. Supabase callbacks

Staging:

- `https://staging.app.techclave.cloud/booka/auth/callback`
- `https://staging.app.techclave.cloud/auth/callback`

Production:

- `https://app.techclave.cloud/booka/auth/callback`
- `https://app.techclave.cloud/auth/callback`

Keep staging and production in separate Supabase projects if possible.

## 5. GitHub environments

Create two GitHub environments:

- `staging`
- `production`

For each environment, add:

- `VPS_HOST`
- `VPS_USER`
- `VPS_SSH_KEY`
- `GHCR_USERNAME`
- `GHCR_TOKEN`

`GHCR_TOKEN` should be a token that can pull from `ghcr.io`.

## 6. Deployment flow

- feature branches -> PR
- `develop` -> `staging`
- `main` -> `production`

Deploy manually on the VPS:

```bash
techclave-deploy staging
techclave-deploy production
```

Or let GitHub Actions run `.github/workflows/deploy-vps.yml`.

## 7. Post-bootstrap checks

Verify:

- `docker ps`
- `nginx -t`
- `systemctl status nginx`
- `curl -I https://staging.app.techclave.cloud/api/health`
- `curl -I https://app.techclave.cloud/api/health`
