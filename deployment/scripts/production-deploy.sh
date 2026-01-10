#!/bin/bash

# Production Deployment Script for Booka Booking System
# Handles complete deployment pipeline with health checks

set -e

# Configuration
APP_NAME="booka"
DOCKER_REGISTRY=${DOCKER_REGISTRY:-""}
VERSION=${VERSION:-"latest"}
ENVIRONMENT=${ENVIRONMENT:-"production"}
HEALTH_CHECK_URL=${HEALTH_CHECK_URL:-"http://localhost:3000/api/health"}
DEPLOY_TIMEOUT=${DEPLOY_TIMEOUT:-"300"}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

success() {
    echo -e "${GREEN}✅ $1${NC}"
}

warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

error() {
    echo -e "${RED}❌ $1${NC}"
}

# Pre-deployment checks
pre_deployment_checks() {
    log "Running pre-deployment checks..."
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        error "Docker is not installed"
        exit 1
    fi
    
    # Check Docker Compose
    if ! command -v docker-compose &> /dev/null; then
        error "Docker Compose is not installed"
        exit 1
    fi
    
    # Check environment variables
    if [ ! -f ".env.${ENVIRONMENT}" ]; then
        error "Environment file .env.${ENVIRONMENT} not found"
        exit 1
    fi
    
    # Check SSL certificates
    if [ "$ENVIRONMENT" = "production" ] && [ ! -f "deployment/nginx/ssl/booka.crt" ]; then
        warning "SSL certificates not found. Run setup-ssl.sh first"
    fi
    
    success "Pre-deployment checks passed"
}

# Build Docker images
build_images() {
    log "Building Docker images..."
    
    if [ -n "$DOCKER_REGISTRY" ]; then
        docker build -t $DOCKER_REGISTRY/$APP_NAME:$VERSION -f Dockerfile.production .
        docker push $DOCKER_REGISTRY/$APP_NAME:$VERSION
        success "Image built and pushed to registry"
    else
        docker build -t $APP_NAME:$VERSION -f Dockerfile.production .
        success "Image built locally"
    fi
}

# Database migration
run_migrations() {
    log "Running database migrations..."
    
    # Run migrations in a temporary container
    docker run --rm \
        --env-file .env.${ENVIRONMENT} \
        --network ${APP_NAME}_booka-network \
        $APP_NAME:$VERSION \
        npm run migrate
    
    success "Database migrations completed"
}

# Deploy services
deploy_services() {
    log "Deploying services..."
    
    # Copy environment file
    cp .env.${ENVIRONMENT} .env
    
    # Deploy with zero-downtime strategy
    if docker-compose -f deployment/docker-compose.production.yml ps | grep -q "Up"; then
        log "Performing rolling update..."
        docker-compose -f deployment/docker-compose.production.yml up -d --no-deps booka-app
        docker-compose -f deployment/docker-compose.production.yml up -d --no-deps booka-worker
    else
        log "Performing fresh deployment..."
        docker-compose -f deployment/docker-compose.production.yml up -d
    fi
    
    success "Services deployed"
}

# Health check
health_check() {
    log "Running health checks..."
    
    local attempt=0
    local max_attempts=30
    
    while [ $attempt -lt $max_attempts ]; do
        if curl -f -s $HEALTH_CHECK_URL > /dev/null; then
            success "Health check passed"
            return 0
        fi
        
        attempt=$((attempt + 1))
        log "Health check attempt $attempt/$max_attempts failed, retrying in 10s..."
        sleep 10
    done
    
    error "Health check failed after $max_attempts attempts"
    return 1
}

# Cleanup old images
cleanup() {
    log "Cleaning up old images..."
    
    docker image prune -f
    docker system prune -f
    
    success "Cleanup completed"
}

# Rollback function
rollback() {
    error "Deployment failed, initiating rollback..."
    
    # Get previous version
    local previous_version=$(docker images $APP_NAME --format "table {{.Tag}}" | sed -n '2p')
    
    if [ -n "$previous_version" ]; then
        log "Rolling back to version: $previous_version"
        
        # Update docker-compose to use previous version
        sed -i "s|image: $APP_NAME:$VERSION|image: $APP_NAME:$previous_version|g" deployment/docker-compose.production.yml
        
        # Redeploy
        docker-compose -f deployment/docker-compose.production.yml up -d
        
        success "Rollback completed"
    else
        error "No previous version found for rollback"
    fi
}

# Main deployment function
main() {
    log "Starting deployment of $APP_NAME v$VERSION to $ENVIRONMENT"
    
    # Set trap for error handling
    trap 'rollback' ERR
    
    pre_deployment_checks
    build_images
    
    # Backup current version tag for rollback
    export PREVIOUS_VERSION=$VERSION
    
    deploy_services
    
    # Wait a moment for services to start
    sleep 30
    
    run_migrations
    health_check
    cleanup
    
    # Remove error trap
    trap - ERR
    
    success "Deployment completed successfully!"
    log "Application is available at: https://$(hostname -f)"
    
    # Show running services
    log "Running services:"
    docker-compose -f deployment/docker-compose.production.yml ps
}

# Script usage
usage() {
    echo "Usage: $0 [OPTIONS]"
    echo "Options:"
    echo "  -v, --version VERSION    Set version tag (default: latest)"
    echo "  -e, --env ENVIRONMENT    Set environment (default: production)"
    echo "  -r, --registry REGISTRY  Set Docker registry URL"
    echo "  -h, --help              Show this help"
    echo ""
    echo "Environment variables:"
    echo "  DOCKER_REGISTRY         Docker registry URL"
    echo "  VERSION                 Version tag"
    echo "  ENVIRONMENT             Deployment environment"
    echo "  HEALTH_CHECK_URL        Health check endpoint"
    echo "  DEPLOY_TIMEOUT          Deployment timeout in seconds"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -v|--version)
            VERSION="$2"
            shift 2
            ;;
        -e|--env)
            ENVIRONMENT="$2"
            shift 2
            ;;
        -r|--registry)
            DOCKER_REGISTRY="$2"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            error "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

# Run main deployment
main