#!/bin/bash

# Health check script for Boka application
# Can be used standalone or by monitoring systems

set -euo pipefail

# Configuration
APP_URL="http://localhost:3000"
TIMEOUT=10
EXIT_CODE=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check application health endpoint
check_app_health() {
    log_info "Checking application health..."
    
    local response
    local http_code
    
    response=$(curl -s -w "\n%{http_code}" --max-time $TIMEOUT "${APP_URL}/api/health" || echo -e "\n000")
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | head -n -1)
    
    if [ "$http_code" = "200" ]; then
        log_info "✅ Application health check passed"
        echo "Response: $body"
    else
        log_error "❌ Application health check failed (HTTP $http_code)"
        echo "Response: $body"
        EXIT_CODE=1
    fi
}

# Check database connectivity
check_database() {
    log_info "Checking database connectivity..."
    
    local response
    local http_code
    
    response=$(curl -s -w "\n%{http_code}" --max-time $TIMEOUT "${APP_URL}/api/health/database" || echo -e "\n000")
    http_code=$(echo "$response" | tail -n1)
    
    if [ "$http_code" = "200" ]; then
        log_info "✅ Database connectivity check passed"
    else
        log_error "❌ Database connectivity check failed (HTTP $http_code)"
        EXIT_CODE=1
    fi
}

# Check Redis connectivity
check_redis() {
    log_info "Checking Redis connectivity..."
    
    if docker ps | grep -q "boka-redis"; then
        if docker exec boka-redis redis-cli ping >/dev/null 2>&1; then
            log_info "✅ Redis connectivity check passed"
        else
            log_error "❌ Redis connectivity check failed"
            EXIT_CODE=1
        fi
    else
        log_warn "⚠️ Redis container not found"
        EXIT_CODE=1
    fi
}

# Check Docker containers
check_containers() {
    log_info "Checking Docker containers..."
    
    local containers=("boka-app" "boka-redis" "boka-nginx" "boka-worker")
    local failed_containers=()
    
    for container in "${containers[@]}"; do
        if docker ps --filter "name=$container" --filter "status=running" | grep -q "$container"; then
            log_info "✅ Container $container is running"
        else
            log_error "❌ Container $container is not running"
            failed_containers+=("$container")
            EXIT_CODE=1
        fi
    done
    
    if [ ${#failed_containers[@]} -gt 0 ]; then
        log_error "Failed containers: ${failed_containers[*]}"
        
        # Show logs for failed containers
        for container in "${failed_containers[@]}"; do
            log_info "Logs for $container:"
            docker logs --tail=10 "$container" 2>&1 || echo "No logs available"
            echo ""
        done
    fi
}

# Check disk space
check_disk_space() {
    log_info "Checking disk space..."
    
    local usage
    usage=$(df / | awk 'NR==2 {print $5}' | sed 's/%//')
    
    if [ "$usage" -gt 90 ]; then
        log_error "❌ Disk usage is ${usage}% (critical)"
        EXIT_CODE=1
    elif [ "$usage" -gt 80 ]; then
        log_warn "⚠️ Disk usage is ${usage}% (warning)"
    else
        log_info "✅ Disk usage is ${usage}% (healthy)"
    fi
}

# Check memory usage
check_memory() {
    log_info "Checking memory usage..."
    
    local memory_info
    memory_info=$(free | grep Mem)
    local total=$(echo $memory_info | awk '{print $2}')
    local used=$(echo $memory_info | awk '{print $3}')
    local usage=$((used * 100 / total))
    
    if [ "$usage" -gt 90 ]; then
        log_error "❌ Memory usage is ${usage}% (critical)"
        EXIT_CODE=1
    elif [ "$usage" -gt 80 ]; then
        log_warn "⚠️ Memory usage is ${usage}% (warning)"
    else
        log_info "✅ Memory usage is ${usage}% (healthy)"
    fi
}

# Check SSL certificate expiry
check_ssl_cert() {
    log_info "Checking SSL certificate..."
    
    local cert_file="/opt/boka/deployment/nginx/ssl/cert.pem"
    
    if [ -f "$cert_file" ]; then
        local expiry_date
        expiry_date=$(openssl x509 -in "$cert_file" -noout -enddate 2>/dev/null | cut -d= -f2)
        
        if [ -n "$expiry_date" ]; then
            local expiry_timestamp
            expiry_timestamp=$(date -d "$expiry_date" +%s)
            local current_timestamp
            current_timestamp=$(date +%s)
            local days_until_expiry
            days_until_expiry=$(( (expiry_timestamp - current_timestamp) / 86400 ))
            
            if [ "$days_until_expiry" -lt 7 ]; then
                log_error "❌ SSL certificate expires in $days_until_expiry days"
                EXIT_CODE=1
            elif [ "$days_until_expiry" -lt 30 ]; then
                log_warn "⚠️ SSL certificate expires in $days_until_expiry days"
            else
                log_info "✅ SSL certificate is valid for $days_until_expiry days"
            fi
        else
            log_error "❌ Cannot read SSL certificate expiry date"
            EXIT_CODE=1
        fi
    else
        log_warn "⚠️ SSL certificate file not found"
    fi
}

# Check log files for errors
check_logs() {
    log_info "Checking recent logs for errors..."
    
    local log_files=(
        "/var/log/nginx/error.log"
        "/opt/boka/logs/app.log"
    )
    
    local error_count=0
    
    for log_file in "${log_files[@]}"; do
        if [ -f "$log_file" ]; then
            local recent_errors
            recent_errors=$(tail -n 100 "$log_file" | grep -i error | wc -l || echo 0)
            
            if [ "$recent_errors" -gt 10 ]; then
                log_warn "⚠️ Found $recent_errors recent errors in $log_file"
                error_count=$((error_count + recent_errors))
            fi
        fi
    done
    
    if [ "$error_count" -gt 50 ]; then
        log_error "❌ High error count detected: $error_count"
        EXIT_CODE=1
    elif [ "$error_count" -gt 0 ]; then
        log_info "✅ Low error count: $error_count errors found"
    else
        log_info "✅ No recent errors found in logs"
    fi
}

# Generate health report
generate_report() {
    local timestamp
    timestamp=$(date -u +"%Y-%m-%d %H:%M:%S UTC")
    
    cat << EOF

=====================================
Boka Health Check Report
=====================================
Timestamp: $timestamp
Overall Status: $([ $EXIT_CODE -eq 0 ] && echo "HEALTHY" || echo "UNHEALTHY")

System Information:
- Hostname: $(hostname)
- Uptime: $(uptime | awk '{print $3,$4}' | sed 's/,//')
- Load Average: $(uptime | awk -F'load average:' '{print $2}')

Docker Containers:
$(docker ps --filter "name=boka" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}")

Recent Application Logs:
$(docker logs --tail=5 boka-app 2>/dev/null | head -5 || echo "No logs available")

=====================================
EOF
}

# Main function
main() {
    echo "🏥 Boka Health Check"
    echo "==================="
    echo ""
    
    # Parse arguments
    DETAILED=false
    REPORT=false
    
    while [[ $# -gt 0 ]]; do
        case $1 in
            --detailed)
                DETAILED=true
                shift
                ;;
            --report)
                REPORT=true
                shift
                ;;
            --help)
                echo "Usage: $0 [--detailed] [--report]"
                echo "  --detailed    Run detailed health checks"
                echo "  --report      Generate detailed health report"
                exit 0
                ;;
            *)
                log_error "Unknown option $1"
                exit 1
                ;;
        esac
    done
    
    # Run basic health checks
    check_app_health
    check_containers
    
    if [ "$DETAILED" = true ]; then
        # Run detailed checks
        check_database
        check_redis
        check_disk_space
        check_memory
        check_ssl_cert
        check_logs
    fi
    
    if [ "$REPORT" = true ]; then
        generate_report
    fi
    
    echo ""
    if [ $EXIT_CODE -eq 0 ]; then
        log_info "🎉 All health checks passed!"
    else
        log_error "💥 Some health checks failed!"
        echo ""
        echo "Troubleshooting steps:"
        echo "1. Check container logs: docker-compose -f /opt/boka/deployment/docker-compose.yml logs"
        echo "2. Restart services: sudo systemctl restart boka"
        echo "3. Check system resources: htop, df -h"
        echo "4. Review application logs: tail -f /opt/boka/logs/app.log"
    fi
    
    exit $EXIT_CODE
}

# Run main function
main "$@"