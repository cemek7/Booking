#!/bin/bash

# SSL/TLS Certificate Setup Script for Booka Production
# Supports Let's Encrypt and self-signed certificates

set -e

# Configuration
DOMAIN=${DOMAIN:-"booka.local"}
EMAIL=${EMAIL:-"admin@booka.local"}
CERT_DIR="/etc/nginx/ssl"
LETSENCRYPT_DIR="/etc/letsencrypt"
USE_LETSENCRYPT=${USE_LETSENCRYPT:-"false"}

echo "🔐 Setting up SSL/TLS certificates for Booka..."

# Create SSL directory
mkdir -p $CERT_DIR

if [ "$USE_LETSENCRYPT" = "true" ]; then
    echo "📜 Setting up Let's Encrypt certificate for domain: $DOMAIN"
    
    # Install certbot if not present
    if ! command -v certbot &> /dev/null; then
        echo "Installing certbot..."
        apt-get update
        apt-get install -y certbot python3-certbot-nginx
    fi
    
    # Generate Let's Encrypt certificate
    certbot --nginx \
        --non-interactive \
        --agree-tos \
        --email $EMAIL \
        --domains $DOMAIN \
        --redirect
    
    # Copy certificates to nginx directory
    cp $LETSENCRYPT_DIR/live/$DOMAIN/fullchain.pem $CERT_DIR/booka.crt
    cp $LETSENCRYPT_DIR/live/$DOMAIN/privkey.pem $CERT_DIR/booka.key
    
    # Set up auto-renewal
    echo "0 12 * * * /usr/bin/certbot renew --quiet" | crontab -
    
    echo "✅ Let's Encrypt certificate installed successfully"
    
else
    echo "🔑 Generating self-signed certificate for domain: $DOMAIN"
    
    # Generate private key
    openssl genrsa -out $CERT_DIR/booka.key 2048
    
    # Create certificate signing request configuration
    cat > $CERT_DIR/csr.conf <<EOF
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
DNS.2 = www.$DOMAIN
DNS.3 = localhost
IP.1 = 127.0.0.1
EOF
    
    # Generate certificate signing request
    openssl req -new -key $CERT_DIR/booka.key -out $CERT_DIR/booka.csr -config $CERT_DIR/csr.conf
    
    # Generate self-signed certificate
    openssl x509 -req \
        -in $CERT_DIR/booka.csr \
        -signkey $CERT_DIR/booka.key \
        -out $CERT_DIR/booka.crt \
        -days 365 \
        -extensions v3_req \
        -extfile $CERT_DIR/csr.conf
    
    # Clean up temporary files
    rm $CERT_DIR/booka.csr $CERT_DIR/csr.conf
    
    echo "✅ Self-signed certificate generated successfully"
    echo "⚠️  Note: Self-signed certificates will show warnings in browsers"
fi

# Set proper permissions
chmod 600 $CERT_DIR/booka.key
chmod 644 $CERT_DIR/booka.crt
chown root:root $CERT_DIR/booka.*

# Verify certificate
echo "🔍 Certificate information:"
openssl x509 -in $CERT_DIR/booka.crt -text -noout | grep -E "(Subject:|Not Before|Not After|DNS:)"

# Test nginx configuration
echo "🧪 Testing nginx configuration..."
nginx -t

echo "🎉 SSL/TLS setup completed successfully!"
echo ""
echo "📋 Next steps:"
echo "1. Update your DNS to point $DOMAIN to this server"
echo "2. Restart nginx: systemctl restart nginx"
echo "3. Test HTTPS access: https://$DOMAIN"

if [ "$USE_LETSENCRYPT" = "true" ]; then
    echo "4. Monitor certificate auto-renewal: certbot renew --dry-run"
fi