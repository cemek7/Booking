#!/bin/bash

# Backup script for Boka application
# Creates backups of application data, database, and Docker volumes

set -euo pipefail

# Configuration
BACKUP_DIR="/opt/backups/boka"
RETENTION_DAYS=30
S3_BUCKET="${BACKUP_S3_BUCKET:-}"
APP_DIR="/opt/boka"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $(date '+%Y-%m-%d %H:%M:%S') $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $(date '+%Y-%m-%d %H:%M:%S') $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $(date '+%Y-%m-%d %H:%M:%S') $1"
}

# Create backup directory
setup_backup_dir() {
    log_info "Setting up backup directory..."
    mkdir -p "$BACKUP_DIR"
    
    # Create subdirectories
    mkdir -p "$BACKUP_DIR"/{daily,weekly,monthly}
}

# Backup application files
backup_application() {
    local backup_name="$1"
    local backup_path="$2"
    
    log_info "Backing up application files..."
    
    if [ -d "$APP_DIR" ]; then
        tar -czf "${backup_path}/${backup_name}-app.tar.gz" \
            -C "$APP_DIR" \
            --exclude='.git' \
            --exclude='node_modules' \
            --exclude='logs' \
            --exclude='.next' \
            .
        
        log_info "Application backup completed: ${backup_name}-app.tar.gz"
    else
        log_warn "Application directory not found: $APP_DIR"
    fi
}

# Backup database
backup_database() {
    local backup_name="$1"
    local backup_path="$2"
    
    log_info "Backing up database..."
    
    # Check if database container is running
    if docker ps | grep -q "postgres"; then
        # Find the postgres container
        local db_container
        db_container=$(docker ps --filter "ancestor=postgres" --format "{{.Names}}" | head -1)
        
        if [ -n "$db_container" ]; then
            # Create database dump
            docker exec "$db_container" pg_dumpall -U postgres > "${backup_path}/${backup_name}-db.sql"
            gzip "${backup_path}/${backup_name}-db.sql"
            
            log_info "Database backup completed: ${backup_name}-db.sql.gz"
        else
            log_warn "PostgreSQL container not found"
        fi
    else
        # For Supabase, we'll backup the schema and migrations
        if [ -d "$APP_DIR/supabase" ]; then
            tar -czf "${backup_path}/${backup_name}-supabase.tar.gz" \
                -C "$APP_DIR" \
                supabase/
            
            log_info "Supabase schema backup completed: ${backup_name}-supabase.tar.gz"
        fi
    fi
}

# Backup Docker volumes
backup_volumes() {
    local backup_name="$1"
    local backup_path="$2"
    
    log_info "Backing up Docker volumes..."
    
    # Get list of volumes with 'boka' in the name
    local volumes
    volumes=$(docker volume ls --filter name=boka --format "{{.Name}}" | tr '\n' ' ')
    
    if [ -n "$volumes" ]; then
        # Create temporary container to backup volumes
        local volume_mounts=""
        for volume in $volumes; do
            volume_mounts="$volume_mounts -v ${volume}:/backup/${volume}:ro"
        done
        
        if [ -n "$volume_mounts" ]; then
            docker run --rm \
                $volume_mounts \
                -v "${backup_path}:/output" \
                alpine \
                tar -czf "/output/${backup_name}-volumes.tar.gz" -C /backup .
            
            log_info "Docker volumes backup completed: ${backup_name}-volumes.tar.gz"
        fi
    else
        log_warn "No Docker volumes found for backup"
    fi
}

# Backup configuration files
backup_config() {
    local backup_name="$1"
    local backup_path="$2"
    
    log_info "Backing up configuration files..."
    
    local config_files=(
        "$APP_DIR/deployment/docker-compose.yml"
        "$APP_DIR/deployment/.env"
        "$APP_DIR/deployment/nginx/nginx.conf"
        "/etc/systemd/system/boka.service"
        "/etc/logrotate.d/boka"
    )
    
    local temp_config_dir
    temp_config_dir=$(mktemp -d)
    
    for file in "${config_files[@]}"; do
        if [ -f "$file" ]; then
            local relative_path
            relative_path=$(echo "$file" | sed "s|^/||")
            local dest_dir
            dest_dir=$(dirname "$temp_config_dir/$relative_path")
            
            mkdir -p "$dest_dir"
            cp "$file" "$temp_config_dir/$relative_path"
        fi
    done
    
    if [ -n "$(ls -A "$temp_config_dir")" ]; then
        tar -czf "${backup_path}/${backup_name}-config.tar.gz" -C "$temp_config_dir" .
        log_info "Configuration backup completed: ${backup_name}-config.tar.gz"
    fi
    
    rm -rf "$temp_config_dir"
}

# Upload to S3 if configured
upload_to_s3() {
    local backup_path="$1"
    local backup_name="$2"
    
    if [ -n "$S3_BUCKET" ] && command -v aws &> /dev/null; then
        log_info "Uploading backup to S3..."
        
        local s3_path="s3://${S3_BUCKET}/boka-backups/$(date +%Y)/$(date +%m)"
        
        # Upload all backup files
        for file in "${backup_path}/${backup_name}"-*.tar.gz "${backup_path}/${backup_name}"-*.sql.gz; do
            if [ -f "$file" ]; then
                aws s3 cp "$file" "$s3_path/" --storage-class STANDARD_IA
                log_info "Uploaded $(basename "$file") to S3"
            fi
        done
        
        # Upload backup manifest
        create_manifest "$backup_path" "$backup_name"
        aws s3 cp "${backup_path}/${backup_name}-manifest.json" "$s3_path/"
        
        log_info "S3 upload completed"
    else
        log_warn "S3 backup not configured or AWS CLI not available"
    fi
}

# Create backup manifest
create_manifest() {
    local backup_path="$1"
    local backup_name="$2"
    
    local manifest_file="${backup_path}/${backup_name}-manifest.json"
    
    cat > "$manifest_file" << EOF
{
  "backup_name": "$backup_name",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)",
  "hostname": "$(hostname)",
  "backup_type": "$(basename "$backup_path")",
  "files": [
EOF
    
    local first=true
    for file in "${backup_path}/${backup_name}"-*.tar.gz "${backup_path}/${backup_name}"-*.sql.gz; do
        if [ -f "$file" ]; then
            if [ "$first" = true ]; then
                first=false
            else
                echo "," >> "$manifest_file"
            fi
            
            local size
            size=$(stat -c%s "$file")
            local checksum
            checksum=$(sha256sum "$file" | awk '{print $1}')
            
            cat >> "$manifest_file" << EOF
    {
      "name": "$(basename "$file")",
      "size": $size,
      "checksum": "$checksum"
    }
EOF
        fi
    done
    
    cat >> "$manifest_file" << EOF
  ],
  "app_version": "$(git -C "$APP_DIR" rev-parse HEAD 2>/dev/null || echo 'unknown')",
  "backup_script_version": "1.0.0"
}
EOF
    
    log_info "Backup manifest created: ${backup_name}-manifest.json"
}

# Cleanup old backups
cleanup_old_backups() {
    local backup_type="$1"
    
    log_info "Cleaning up old ${backup_type} backups..."
    
    # Remove backups older than retention period
    find "${BACKUP_DIR}/${backup_type}" -name "*.tar.gz" -o -name "*.sql.gz" -o -name "*.json" | \
        while read -r file; do
            if [ "$(find "$file" -mtime +${RETENTION_DAYS} -print)" ]; then
                log_info "Removing old backup: $(basename "$file")"
                rm -f "$file"
            fi
        done
    
    # Cleanup S3 if configured
    if [ -n "$S3_BUCKET" ] && command -v aws &> /dev/null; then
        local cutoff_date
        cutoff_date=$(date -d "${RETENTION_DAYS} days ago" +%Y-%m-%d)
        
        aws s3 ls "s3://${S3_BUCKET}/boka-backups/" --recursive | \
            awk '$1" "$2 < "'$cutoff_date'" {print $4}' | \
            while read -r key; do
                if [ -n "$key" ]; then
                    aws s3 rm "s3://${S3_BUCKET}/$key"
                    log_info "Removed old S3 backup: $key"
                fi
            done
    fi
}

# Verify backup integrity
verify_backup() {
    local backup_path="$1"
    local backup_name="$2"
    
    log_info "Verifying backup integrity..."
    
    local verification_failed=false
    
    # Verify each backup file
    for file in "${backup_path}/${backup_name}"-*.tar.gz; do
        if [ -f "$file" ]; then
            if tar -tzf "$file" >/dev/null 2>&1; then
                log_info "✅ $(basename "$file") is valid"
            else
                log_error "❌ $(basename "$file") is corrupted"
                verification_failed=true
            fi
        fi
    done
    
    # Verify SQL dumps
    for file in "${backup_path}/${backup_name}"-*.sql.gz; do
        if [ -f "$file" ]; then
            if gzip -t "$file" 2>/dev/null; then
                log_info "✅ $(basename "$file") is valid"
            else
                log_error "❌ $(basename "$file") is corrupted"
                verification_failed=true
            fi
        fi
    done
    
    if [ "$verification_failed" = true ]; then
        log_error "Backup verification failed!"
        return 1
    else
        log_info "Backup verification successful!"
        return 0
    fi
}

# Send notification (if configured)
send_notification() {
    local status="$1"
    local backup_name="$2"
    local message="$3"
    
    # Slack notification (if webhook is configured)
    if [ -n "${SLACK_WEBHOOK_URL:-}" ]; then
        local color
        if [ "$status" = "success" ]; then
            color="good"
        else
            color="danger"
        fi
        
        curl -X POST -H 'Content-type: application/json' \
            --data "{
                \"attachments\": [{
                    \"color\": \"$color\",
                    \"title\": \"Boka Backup $status\",
                    \"text\": \"$message\",
                    \"fields\": [{
                        \"title\": \"Backup Name\",
                        \"value\": \"$backup_name\",
                        \"short\": true
                    }, {
                        \"title\": \"Hostname\",
                        \"value\": \"$(hostname)\",
                        \"short\": true
                    }]
                }]
            }" \
            "$SLACK_WEBHOOK_URL"
    fi
    
    # Email notification (if configured)
    if [ -n "${NOTIFICATION_EMAIL:-}" ] && command -v mail &> /dev/null; then
        echo "$message" | mail -s "Boka Backup $status - $backup_name" "$NOTIFICATION_EMAIL"
    fi
}

# Main backup function
main() {
    local backup_type="${1:-daily}"
    
    log_info "🔄 Starting Boka backup ($backup_type)..."
    
    # Validate backup type
    case "$backup_type" in
        daily|weekly|monthly)
            ;;
        *)
            log_error "Invalid backup type: $backup_type. Use: daily, weekly, or monthly"
            exit 1
            ;;
    esac
    
    # Setup
    setup_backup_dir
    
    # Generate backup name
    local timestamp
    timestamp=$(date +%Y%m%d-%H%M%S)
    local backup_name="boka-${backup_type}-${timestamp}"
    local backup_path="${BACKUP_DIR}/${backup_type}"
    
    # Perform backup
    local start_time
    start_time=$(date +%s)
    
    backup_application "$backup_name" "$backup_path"
    backup_database "$backup_name" "$backup_path"
    backup_volumes "$backup_name" "$backup_path"
    backup_config "$backup_name" "$backup_path"
    
    # Calculate backup time
    local end_time
    end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    # Verify backup
    if verify_backup "$backup_path" "$backup_name"; then
        # Upload to S3
        upload_to_s3 "$backup_path" "$backup_name"
        
        # Cleanup old backups
        cleanup_old_backups "$backup_type"
        
        # Calculate total backup size
        local total_size
        total_size=$(du -sh "${backup_path}/${backup_name}"-* | awk '{s+=$1} END {print s}')
        
        log_info "✅ Backup completed successfully!"
        log_info "Duration: ${duration}s"
        log_info "Total size: ${total_size:-unknown}"
        
        send_notification "success" "$backup_name" "Backup completed successfully in ${duration}s"
        exit 0
    else
        log_error "❌ Backup failed verification!"
        send_notification "failed" "$backup_name" "Backup verification failed"
        exit 1
    fi
}

# Handle command line arguments
case "${1:-daily}" in
    --help|-h)
        cat << EOF
Boka Backup Script

Usage: $0 [backup_type]

backup_type:
  daily    - Create daily backup (default)
  weekly   - Create weekly backup  
  monthly  - Create monthly backup

Environment Variables:
  BACKUP_S3_BUCKET     - S3 bucket for backup storage
  SLACK_WEBHOOK_URL    - Slack webhook for notifications
  NOTIFICATION_EMAIL   - Email address for notifications

Examples:
  $0                   # Daily backup
  $0 weekly           # Weekly backup  
  $0 monthly          # Monthly backup
EOF
        exit 0
        ;;
    *)
        main "$@"
        ;;
esac