#!/bin/bash

# Production deployment script for Boka booking system
# Run this script on your production server

set -euo pipefail

echo "🚀 Starting Boka deployment..."

# Configuration
APP_NAME="boka"
BACKUP_DIR="/opt/backups/${APP_NAME}"
DEPLOY_DIR="/opt/${APP_NAME}"
DOCKER_COMPOSE_FILE="${DEPLOY_DIR}/deployment/docker-compose.yml"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed"
        exit 1
    fi
    
    if ! command -v docker-compose &> /dev/null; then
        log_error "Docker Compose is not installed"
        exit 1
    fi
    
    if ! command -v git &> /dev/null; then
        log_error "Git is not installed"
        exit 1
    fi
    
    log_info "Prerequisites check passed"
}

# Create backup
create_backup() {
    log_info "Creating backup..."
    
    mkdir -p "$BACKUP_DIR"
    BACKUP_NAME="${APP_NAME}-$(date +%Y%m%d-%H%M%S)"
    
    if [ -d "$DEPLOY_DIR" ]; then
        # Backup application data
        tar -czf "${BACKUP_DIR}/${BACKUP_NAME}-app.tar.gz" -C "$DEPLOY_DIR" . || true
        
        # Export database if running
        if docker ps | grep -q "${APP_NAME}-postgres"; then
            docker exec "${APP_NAME}-postgres" pg_dump -U postgres app_db > "${BACKUP_DIR}/${BACKUP_NAME}-db.sql" || true
        fi
        
        # Backup Docker volumes
        if docker volume ls | grep -q "${APP_NAME}"; then
            docker run --rm \
                $(docker volume ls | grep "${APP_NAME}" | awk '{print "-v " $2 ":/backup-" $2 ":ro"}') \
                -v "${BACKUP_DIR}:/backup" \
                alpine tar -czf "/backup/${BACKUP_NAME}-volumes.tar.gz" /backup-* || true
        fi
        
        log_info "Backup created: ${BACKUP_NAME}"
    else
        log_warn "No existing deployment found, skipping backup"
    fi
}

# Setup deployment directory
setup_deployment() {
    log_info "Setting up deployment directory..."
    
    # Create deployment directory
    sudo mkdir -p "$DEPLOY_DIR"
    sudo chown $USER:$USER "$DEPLOY_DIR"
    
    # Clone or update repository
    if [ -d "${DEPLOY_DIR}/.git" ]; then
        log_info "Updating existing repository..."
        cd "$DEPLOY_DIR"
        git fetch origin
        git reset --hard origin/main
    else
        log_info "Cloning repository..."
        git clone https://github.com/your-username/boka.git "$DEPLOY_DIR"
        cd "$DEPLOY_DIR"
    fi
    
    # Copy environment file if it doesn't exist
    if [ ! -f "${DEPLOY_DIR}/deployment/.env" ]; then
        cp "${DEPLOY_DIR}/deployment/.env.example" "${DEPLOY_DIR}/deployment/.env"
        log_warn "Please edit ${DEPLOY_DIR}/deployment/.env with your configuration"
        log_warn "Press Enter when ready to continue..."
        read
    fi
}

# Generate SSL certificates
generate_ssl() {
    log_info "Setting up SSL certificates..."
    
    SSL_DIR="${DEPLOY_DIR}/deployment/nginx/ssl"
    mkdir -p "$SSL_DIR"
    
    if [ ! -f "${SSL_DIR}/cert.pem" ] || [ ! -f "${SSL_DIR}/key.pem" ]; then
        log_warn "SSL certificates not found. Generating self-signed certificates..."
        
        openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
            -keyout "${SSL_DIR}/key.pem" \
            -out "${SSL_DIR}/cert.pem" \
            -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"
        
        log_warn "Self-signed certificates generated. Replace with real certificates for production."
    fi
}

# Deploy application
deploy_application() {
    log_info "Deploying application..."
    
    cd "$DEPLOY_DIR"
    
    # Pull latest images
    docker-compose -f "$DOCKER_COMPOSE_FILE" pull
    
    # Build application
    docker-compose -f "$DOCKER_COMPOSE_FILE" build --no-cache
    
    # Stop existing containers
    docker-compose -f "$DOCKER_COMPOSE_FILE" down || true
    
    # Start services
    docker-compose -f "$DOCKER_COMPOSE_FILE" up -d
    
    log_info "Waiting for services to start..."
    sleep 30
    
    # Check service health
    check_health
}

# Check application health
check_health() {
    log_info "Checking application health..."
    
    # Wait for app to be ready
    MAX_RETRIES=30
    RETRY_COUNT=0
    
    while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
        if curl -f http://localhost/api/health >/dev/null 2>&1; then
            log_info "Application is healthy!"
            return 0
        fi
        
        log_info "Waiting for application... ($RETRY_COUNT/$MAX_RETRIES)"
        sleep 10
        RETRY_COUNT=$((RETRY_COUNT + 1))
    done
    
    log_error "Application health check failed"
    log_info "Container logs:"
    docker-compose -f "$DOCKER_COMPOSE_FILE" logs --tail=50
    
    return 1
}

# Setup monitoring
setup_monitoring() {
    log_info "Setting up monitoring..."
    
    # Ensure Grafana is accessible
    if curl -f http://localhost:3001/login >/dev/null 2>&1; then
        log_info "Grafana is accessible at http://localhost:3001"
        log_info "Default credentials - Username: admin, Password: (check .env file)"
    else
        log_warn "Grafana may not be ready yet. Check docker-compose logs."
    fi
    
    # Ensure Prometheus is accessible
    if curl -f http://localhost:9090 >/dev/null 2>&1; then
        log_info "Prometheus is accessible at http://localhost:9090"
    else
        log_warn "Prometheus may not be ready yet. Check docker-compose logs."
    fi
}

# Setup log rotation
setup_log_rotation() {
    log_info "Setting up log rotation..."
    
    sudo tee /etc/logrotate.d/boka > /dev/null <<EOF
/opt/boka/logs/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    create 644 www-data www-data
    postrotate
        docker kill -s HUP \$(docker ps -q --filter name=boka-nginx) || true
    endscript
}
EOF
    
    log_info "Log rotation configured"
}

# Setup systemd service
setup_systemd() {
    log_info "Setting up systemd service..."
    
    sudo tee /etc/systemd/system/boka.service > /dev/null <<EOF
[Unit]
Description=Boka Booking System
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${DEPLOY_DIR}
ExecStart=/usr/bin/docker-compose -f ${DOCKER_COMPOSE_FILE} up -d
ExecStop=/usr/bin/docker-compose -f ${DOCKER_COMPOSE_FILE} down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF
    
    sudo systemctl daemon-reload
    sudo systemctl enable boka
    
    log_info "Systemd service configured"
}

# Cleanup old images and containers
cleanup() {
    log_info "Cleaning up old Docker resources..."
    
    # Remove unused images
    docker image prune -f
    
    # Remove unused volumes (be careful with this)
    # docker volume prune -f
    
    log_info "Cleanup completed"
}

# Main deployment function
main() {
    log_info "🚀 Boka Deployment Script"
    log_info "=========================="
    
    # Parse command line arguments
    SKIP_BACKUP=false
    SKIP_HEALTH_CHECK=false
    
    while [[ $# -gt 0 ]]; do
        case $1 in
            --skip-backup)
                SKIP_BACKUP=true
                shift
                ;;
            --skip-health-check)
                SKIP_HEALTH_CHECK=true
                shift
                ;;
            --help)
                echo "Usage: $0 [--skip-backup] [--skip-health-check]"
                echo "  --skip-backup       Skip backup creation"
                echo "  --skip-health-check Skip health check after deployment"
                exit 0
                ;;
            *)
                log_error "Unknown option $1"
                exit 1
                ;;
        esac
    done
    
    # Run deployment steps
    check_prerequisites
    
    if [ "$SKIP_BACKUP" = false ]; then
        create_backup
    fi
    
    setup_deployment
    generate_ssl
    deploy_application
    
    if [ "$SKIP_HEALTH_CHECK" = false ]; then
        if ! check_health; then
            log_error "Deployment failed health check"
            exit 1
        fi
    fi
    
    setup_monitoring
    setup_log_rotation
    setup_systemd
    cleanup
    
    log_info "✅ Deployment completed successfully!"
    log_info ""
    log_info "Application URLs:"
    log_info "  - Main App: https://localhost"
    log_info "  - Grafana: http://localhost:3001"
    log_info "  - Prometheus: http://localhost:9090"
    log_info ""
    log_info "Useful commands:"
    log_info "  - View logs: docker-compose -f ${DOCKER_COMPOSE_FILE} logs -f"
    log_info "  - Restart services: sudo systemctl restart boka"
    log_info "  - Check status: docker-compose -f ${DOCKER_COMPOSE_FILE} ps"
}

# Run main function with all arguments
main "$@"