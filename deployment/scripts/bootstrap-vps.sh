#!/usr/bin/env bash

set -euo pipefail

APP_DOMAIN="${APP_DOMAIN:-app.techclave.cloud}"
STAGING_DOMAIN="${STAGING_DOMAIN:-staging.app.techclave.cloud}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-ops@techclave.cloud}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
STACK_ROOT="${STACK_ROOT:-/opt/techclave}"
PROD_PORT="${PROD_PORT:-3200}"
STAGING_PORT="${STAGING_PORT:-3100}"
RUN_CERTBOT="${RUN_CERTBOT:-false}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NGINX_TEMPLATE="$REPO_ROOT/deployment/nginx/vps-site.conf.template"
COMPOSE_TEMPLATE="$REPO_ROOT/deployment/docker-compose.vps.yml"
PROD_ENV_TEMPLATE="$REPO_ROOT/deployment/env/.env.production.example"
STAGING_ENV_TEMPLATE="$REPO_ROOT/deployment/env/.env.staging.example"
DEPLOY_SCRIPT_SOURCE="$REPO_ROOT/deployment/scripts/deploy-vps.sh"

usage() {
  cat <<EOF
Usage: $0 [options]

Options:
  --deploy-user USER        Linux user used for deployments
  --app-domain DOMAIN       Production application domain
  --staging-domain DOMAIN   Staging application domain
  --email EMAIL             Let's Encrypt email
  --stack-root PATH         Deployment root directory
  --prod-port PORT          Internal production app port
  --staging-port PORT       Internal staging app port

Environment flags:
  RUN_CERTBOT=true          Request TLS certificates after nginx setup
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --deploy-user) DEPLOY_USER="$2"; shift 2 ;;
    --app-domain) APP_DOMAIN="$2"; shift 2 ;;
    --staging-domain) STAGING_DOMAIN="$2"; shift 2 ;;
    --email) LETSENCRYPT_EMAIL="$2"; shift 2 ;;
    --stack-root) STACK_ROOT="$2"; shift 2 ;;
    --prod-port) PROD_PORT="$2"; shift 2 ;;
    --staging-port) STAGING_PORT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    echo "Run this script as root." >&2
    exit 1
  fi
}

install_packages() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl git gnupg nginx certbot python3-certbot-nginx ufw docker.io docker-compose-plugin
  systemctl enable --now docker nginx
}

ensure_user() {
  if ! id -u "$DEPLOY_USER" >/dev/null 2>&1; then
    useradd -m -s /bin/bash "$DEPLOY_USER"
  fi
  usermod -aG docker "$DEPLOY_USER"
}

prepare_directories() {
  mkdir -p "$STACK_ROOT"/{prod,staging}
  install -m 755 "$DEPLOY_SCRIPT_SOURCE" /usr/local/bin/techclave-deploy
  install -m 644 "$COMPOSE_TEMPLATE" "$STACK_ROOT/prod/docker-compose.yml"
  install -m 644 "$COMPOSE_TEMPLATE" "$STACK_ROOT/staging/docker-compose.yml"

  if [[ ! -f "$STACK_ROOT/prod/.env" ]]; then
    install -m 640 "$PROD_ENV_TEMPLATE" "$STACK_ROOT/prod/.env"
  fi
  if [[ ! -f "$STACK_ROOT/staging/.env" ]]; then
    install -m 640 "$STAGING_ENV_TEMPLATE" "$STACK_ROOT/staging/.env"
  fi

  chown -R "$DEPLOY_USER:$DEPLOY_USER" "$STACK_ROOT"
}

render_nginx_site() {
  local server_name="$1"
  local app_port="$2"
  local target="/etc/nginx/sites-available/${server_name}.conf"

  sed \
    -e "s/__SERVER_NAME__/${server_name}/g" \
    -e "s/__APP_PORT__/${app_port}/g" \
    "$NGINX_TEMPLATE" > "$target"

  ln -sf "$target" "/etc/nginx/sites-enabled/${server_name}.conf"
}

configure_nginx() {
  rm -f /etc/nginx/sites-enabled/default
  render_nginx_site "$APP_DOMAIN" "$PROD_PORT"
  render_nginx_site "$STAGING_DOMAIN" "$STAGING_PORT"
  nginx -t
  systemctl reload nginx
}

configure_firewall() {
  ufw allow OpenSSH
  ufw allow 'Nginx Full'
  ufw --force enable
}

run_certbot() {
  certbot --nginx \
    --non-interactive \
    --agree-tos \
    --redirect \
    -m "$LETSENCRYPT_EMAIL" \
    -d "$APP_DOMAIN" \
    -d "$STAGING_DOMAIN"
}

print_summary() {
  cat <<EOF

VPS scaffold created.

Stack root:
  $STACK_ROOT

Environment files:
  $STACK_ROOT/prod/.env
  $STACK_ROOT/staging/.env

Nginx vhosts:
  https://$APP_DOMAIN  -> 127.0.0.1:$PROD_PORT
  https://$STAGING_DOMAIN -> 127.0.0.1:$STAGING_PORT

Next actions:
1. Point DNS for both domains to this VPS.
2. Fill the staging and production .env files.
3. Register Supabase redirect URLs for both domains.
4. If DNS is already live, rerun with RUN_CERTBOT=true.
5. Deploy with:
   techclave-deploy staging
   techclave-deploy production
EOF
}

require_root
install_packages
ensure_user
prepare_directories
configure_nginx
configure_firewall

if [[ "$RUN_CERTBOT" == "true" ]]; then
  run_certbot
fi

print_summary
