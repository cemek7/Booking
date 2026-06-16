#!/bin/bash

# SSL/TLS Certificate Setup for Booka — dockerized nginx (standalone ACME).
#
# The production nginx runs in a container that mounts ./deployment/nginx/ssl as
# /etc/nginx/ssl (read-only) and reads booka.crt / booka.key. certbot's --nginx plugin
# can't see a containerized nginx, so we issue with --standalone (certbot binds :80
# directly while the nginx container is briefly stopped) and copy the result into the
# mounted dir.
#
# Usage:
#   DOMAIN=techclave.cloud EMAIL=you@techclave.cloud USE_LETSENCRYPT=true ./setup-ssl.sh
#   DOMAIN=techclave.cloud ./setup-ssl.sh            # self-signed (local/testing)

set -euo pipefail

DOMAIN=${DOMAIN:-"booka.local"}
WWW_DOMAIN=${WWW_DOMAIN:-"www.${DOMAIN}"}
EMAIL=${EMAIL:-"admin@${DOMAIN}"}
USE_LETSENCRYPT=${USE_LETSENCRYPT:-"false"}

# Resolve the repo's mounted ssl dir relative to this script (deployment/nginx/ssl).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERT_DIR=${CERT_DIR:-"$(cd "$SCRIPT_DIR/.." && pwd)/nginx/ssl"}
LETSENCRYPT_DIR="/etc/letsencrypt"

# Docker wiring (override if your file/container names differ).
COMPOSE=${COMPOSE:-"docker compose -f $(cd "$SCRIPT_DIR/../.." && pwd)/deployment/docker-compose.production.yml"}
NGINX_CONTAINER=${NGINX_CONTAINER:-"booka-nginx"}

echo "🔐 Booka SSL setup — domain: $DOMAIN (+$WWW_DOMAIN), certs -> $CERT_DIR"
mkdir -p "$CERT_DIR"

reload_or_start_nginx() {
  # Start nginx if stopped; reload if running.
  if docker ps --format '{{.Names}}' | grep -q "^${NGINX_CONTAINER}$"; then
    docker exec "$NGINX_CONTAINER" nginx -s reload || true
  else
    $COMPOSE up -d nginx || true
  fi
}

if [ "$USE_LETSENCRYPT" = "true" ]; then
  echo "📜 Let's Encrypt via standalone ACME (nginx container stopped during issuance)"

  if ! command -v certbot &> /dev/null; then
    echo "Installing certbot..."
    apt-get update && apt-get install -y certbot
  fi

  # Free port 80 for the standalone challenge.
  $COMPOSE stop nginx || true

  certbot certonly --standalone \
    --non-interactive --agree-tos \
    --email "$EMAIL" \
    -d "$DOMAIN" -d "$WWW_DOMAIN"

  # certbot stores under the first -d domain.
  cp "$LETSENCRYPT_DIR/live/$DOMAIN/fullchain.pem" "$CERT_DIR/booka.crt"
  cp "$LETSENCRYPT_DIR/live/$DOMAIN/privkey.pem"  "$CERT_DIR/booka.key"

  # Auto-renew: stop nginx for the standalone bind, copy renewed certs, restart nginx.
  CRON_LINE="0 3 * * * certbot renew --standalone \
--pre-hook '$COMPOSE stop nginx' \
--deploy-hook 'cp $LETSENCRYPT_DIR/live/$DOMAIN/fullchain.pem $CERT_DIR/booka.crt && cp $LETSENCRYPT_DIR/live/$DOMAIN/privkey.pem $CERT_DIR/booka.key' \
--post-hook '$COMPOSE up -d nginx' >> /var/log/certbot-renew.log 2>&1"
  ( crontab -l 2>/dev/null | grep -v 'certbot renew' ; echo "$CRON_LINE" ) | crontab -

  $COMPOSE up -d nginx
  echo "✅ Let's Encrypt certificate installed; renewal cron added (03:00 daily)."

else
  echo "🔑 Generating self-signed certificate (browsers will warn) — for local/testing"

  openssl genrsa -out "$CERT_DIR/booka.key" 2048

  cat > "$CERT_DIR/csr.conf" <<EOF
[req]
default_bits = 2048
prompt = no
distinguished_name = dn
req_extensions = v3_req

[dn]
C=US
ST=CA
L=San Francisco
O=Booka
OU=IT Department
CN=$DOMAIN

[v3_req]
basicConstraints = CA:FALSE
keyUsage = nonRepudiation, digitalSignature, keyEncipherment
subjectAltName = @alt_names

[alt_names]
DNS.1 = $DOMAIN
DNS.2 = $WWW_DOMAIN
DNS.3 = localhost
IP.1 = 127.0.0.1
EOF

  openssl req -new -key "$CERT_DIR/booka.key" -out "$CERT_DIR/booka.csr" -config "$CERT_DIR/csr.conf"
  openssl x509 -req \
    -in "$CERT_DIR/booka.csr" \
    -signkey "$CERT_DIR/booka.key" \
    -out "$CERT_DIR/booka.crt" \
    -days 365 -extensions v3_req -extfile "$CERT_DIR/csr.conf"

  rm -f "$CERT_DIR/booka.csr" "$CERT_DIR/csr.conf"
  echo "✅ Self-signed certificate generated."
  reload_or_start_nginx
fi

chmod 600 "$CERT_DIR/booka.key"
chmod 644 "$CERT_DIR/booka.crt"

echo "🔍 Certificate:"
openssl x509 -in "$CERT_DIR/booka.crt" -text -noout | grep -E "(Subject:|Not Before|Not After|DNS:)"

echo ""
echo "🎉 Done. nginx reads /etc/nginx/ssl/booka.crt + booka.key (mounted from $CERT_DIR)."
echo "📋 Next: ensure DNS for $DOMAIN points here, then: $COMPOSE up -d"
echo "    Verify: https://$DOMAIN/api/health"
