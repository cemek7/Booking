# Booka VPS Launch Runbook

Use this when you are ready to deploy the repo onto a single VPS with:
- Next.js app process
- background worker process
- Redis in Docker on the VPS
- Nginx reverse proxy

This runbook assumes Ubuntu 22.04+ and a fresh server.

## 1. Server prep

```bash
sudo apt update
sudo apt install -y git curl ca-certificates build-essential nginx
```

Install Node.js 20:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

Optional but recommended for process supervision:

```bash
sudo npm install -g pm2
```

## 2. Redis setup

Install Docker if it is not already present, then create a strong Redis password:

```bash
export REDIS_PASSWORD='replace-with-a-long-random-password'
```

Start Redis in Docker and bind it to localhost only:

```bash
docker run -d \
  --name booka-redis \
  --restart unless-stopped \
  -p 127.0.0.1:6379:6379 \
  redis:7-alpine \
  redis-server --appendonly yes --requirepass "$REDIS_PASSWORD"

docker exec booka-redis redis-cli -a "$REDIS_PASSWORD" ping
```

Your app env should use:

```bash
REDIS_URL=redis://:replace-with-a-long-random-password@127.0.0.1:6379/0
REDIS_ENABLED=true
```

## 3. Deploy the repo

```bash
sudo mkdir -p /opt/booka
sudo chown "$USER":"$USER" /opt/booka
git clone <YOUR_GITHUB_REPO_URL> /opt/booka
cd /opt/booka/Booking
```

Create the production env file:

```bash
cp env.example .env.production
nano .env.production
```

## 4. Production env vars

Populate these first:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXTAUTH_SECRET=
ENCRYPTION_KEY=
CRON_SECRET=
APP_URL=https://your-domain.com
NEXT_PUBLIC_APP_URL=https://your-domain.com
NEXTAUTH_URL=https://your-domain.com
REDIS_URL=redis://:replace-with-a-long-random-password@127.0.0.1:6379/0
REDIS_ENABLED=true
```

If you are using WAHA as the first production provider:

```bash
ENABLE_WHATSAPP_INTEGRATION=true
DEFAULT_WHATSAPP_PROVIDER=waha
WAHA_API_BASE=http://127.0.0.1:3100
WAHA_API_KEY=
WAHA_ALLOWED_BASE_HOSTS=127.0.0.1:3100
WAHA_AUTO_PROVISION_ENABLED=true
WAHA_AUTO_PROVISION_REQUIRED=true
WAHA_ALLOW_SHARED_ENDPOINTS=false
WAHA_TENANT_ENDPOINTS_JSON=
WAHA_CORE_ENDPOINT_POOL_JSON=
WAHA_PROVISIONER_WEBHOOK_URL=
WAHA_PROVISIONER_TOKEN=
```

If you are using Meta Cloud API instead:

```bash
ENABLE_WHATSAPP_INTEGRATION=true
DEFAULT_WHATSAPP_PROVIDER=meta
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_APP_SECRET=
WHATSAPP_WEBHOOK_VERIFY_TOKEN=
WHATSAPP_API_VERSION=v18.0
WHATSAPP_BASE_URL=https://graph.facebook.com
```

If you want Evolution as fallback:

```bash
EVOLUTION_API_BASE=
EVOLUTION_API_KEY=
EVOLUTION_WEBHOOK_SECRET=
EVOLUTION_INSTANCE_NAME=booka_instance
```

If AI replies are enabled:

```bash
OPENROUTER_API_KEY=
OPENROUTER_MODEL=gpt-4o-mini
WHATSAPP_V2_AI_PROVIDER=openrouter
WHATSAPP_V2_DISABLE_GOOGLE=true
OPENROUTER_V2_FALLBACK_MODELS=
```

## 5. Install and build

```bash
npm ci
npm run build
```

## 6. Start the app and worker

Using PM2:

```bash
pm2 start npm --name booka-web -- start
pm2 start npm --name booka-worker -- run worker
pm2 save
pm2 startup systemd -u "$USER" --hp "$HOME"
```

If you prefer plain foreground processes for first boot checks:

```bash
npm run start
npm run worker
```

## 7. Nginx reverse proxy

Create a site config:

```bash
sudo tee /etc/nginx/sites-available/booka >/dev/null <<'EOF'
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
EOF
```

Enable the site and reload Nginx:

```bash
sudo ln -sf /etc/nginx/sites-available/booka /etc/nginx/sites-enabled/booka
sudo nginx -t
sudo systemctl reload nginx
```

If you want TLS:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

## 8. Required migrations

Apply these in Supabase before launch:

- `073_whatsapp_queue_claim_rpc.sql`
- `074_cron_lock_rpc.sql`
- `075_whatsapp_provider_secrets.sql`
- `076_alert_rules.sql`

If your only observed launch-time health issue is the observability alert table, the specific file to apply is:

- `db/migrations/076_alert_rules.sql`

## 9. Smoke tests

Run these after the app is live:

```bash
curl -f https://your-domain.com/api/ready
curl -f https://your-domain.com/api/health
```

Then verify:
- inbound WhatsApp message creates a conversation
- outbound manual send works
- AI reply returns
- retry queue processes a forced failure
- worker cron runs once without error

## 10. Hard go-live rule

Do not open to paying clients until all of these are true:
- Redis is reachable with `REDIS_URL`
- the four migrations above are applied
- `/api/ready` returns ready
- `/api/health` returns healthy or acceptable degraded status
- at least one inbound and one outbound WhatsApp test pass on the VPS
