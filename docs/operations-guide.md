# Boka Booking System - Production Operations Guide

## Table of Contents

1. [System Overview](#system-overview)
2. [Deployment Guide](#deployment-guide)
3. [Monitoring & Observability](#monitoring--observability)
4. [Backup & Recovery](#backup--recovery)
5. [Troubleshooting Guide](#troubleshooting-guide)
6. [Security Procedures](#security-procedures)
7. [Maintenance Tasks](#maintenance-tasks)
8. [Emergency Procedures](#emergency-procedures)

## System Overview

### Architecture

The Boka booking system is a cloud-native application built with:

- **Frontend**: Next.js with TypeScript
- **Backend**: Next.js API routes with enhanced authentication
- **Database**: Supabase (PostgreSQL with Row Level Security)
- **Caching**: Redis
- **Reverse Proxy**: Nginx
- **Monitoring**: Prometheus + Grafana
- **Containerization**: Docker & Docker Compose

### Infrastructure Components

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Nginx     │    │  Boka App   │    │   Worker    │
│ (Port 80/   │────│ (Port 3000) │────│ Background  │
│ 443)        │    │             │    │ Tasks       │
└─────────────┘    └─────────────┘    └─────────────┘
       │                   │                   │
       │                   │                   │
    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
    │  Grafana    │    │   Redis     │    │ Prometheus  │
    │ (Port 3001) │    │ (Port 6379) │    │ (Port 9090) │
    └─────────────┘    └─────────────┘    └─────────────┘
```

### Service Dependencies

- **Boka App** depends on: Supabase, Redis
- **Worker** depends on: Supabase, Redis
- **Nginx** depends on: Boka App
- **Grafana** depends on: Prometheus
- **Prometheus** depends on: All services (for metrics)

## Deployment Guide

### Prerequisites

- Linux server (Ubuntu 20.04+ recommended)
- Docker & Docker Compose installed
- Domain name and SSL certificate
- Supabase project configured

### Initial Deployment

1. **Prepare the server:**
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/download/v2.20.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Create application directory
sudo mkdir -p /opt/boka
sudo chown $USER:$USER /opt/boka
```

2. **Deploy the application:**
```bash
# Clone repository
cd /opt/boka
git clone https://github.com/your-org/boka.git .

# Configure environment
cp deployment/.env.example deployment/.env
# Edit .env with your configuration
nano deployment/.env

# SSL certificates (if using custom domain)
sudo mkdir -p deployment/nginx/ssl
# Copy your SSL certificate files to deployment/nginx/ssl/

# Start services
cd deployment
docker-compose up -d

# Verify deployment
docker-compose ps
```

3. **Run database migrations:**
```bash
# Run Supabase migrations
npx supabase db push

# Seed initial data (optional)
npm run seed:production
```

### Environment Configuration

#### Required Environment Variables

```bash
# Database
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Authentication
NEXTAUTH_URL=https://your-domain.com
NEXTAUTH_SECRET=your-nextauth-secret
ENCRYPTION_KEY=your-32-character-encryption-key
TOTP_SERVICE_NAME=BookingSystem

# Redis
REDIS_PASSWORD=your-redis-password

# Monitoring
GRAFANA_PASSWORD=your-grafana-password

# Optional: External services
STRIPE_SECRET_KEY=your-stripe-secret
SENDGRID_API_KEY=your-sendgrid-key
```

### SSL Configuration

#### Let's Encrypt (Recommended)

```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx

# Obtain certificate
sudo certbot --nginx -d your-domain.com -d www.your-domain.com

# Auto-renewal
sudo crontab -e
# Add: 0 12 * * * /usr/bin/certbot renew --quiet
```

#### Custom Certificate

```bash
# Place your certificate files
sudo cp your-cert.pem /opt/boka/deployment/nginx/ssl/cert.pem
sudo cp your-key.pem /opt/boka/deployment/nginx/ssl/key.pem
sudo chmod 600 /opt/boka/deployment/nginx/ssl/*
```

### Systemd Service

Create a systemd service for automatic startup:

```bash
sudo nano /etc/systemd/system/boka.service
```

```ini
[Unit]
Description=Boka Booking System
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/boka/deployment
ExecStart=/usr/local/bin/docker-compose up -d
ExecStop=/usr/local/bin/docker-compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable boka
sudo systemctl start boka
```

## Monitoring & Observability

### Health Checks

#### Application Health
```bash
# Manual health check
curl -f http://localhost:3000/api/health

# Automated health check script
/opt/boka/deployment/scripts/health-check.sh --detailed
```

#### Service Status
```bash
# Check all containers
docker-compose -f /opt/boka/deployment/docker-compose.yml ps

# Check specific service
docker logs boka-app --tail=100
docker logs boka-worker --tail=100
docker logs boka-nginx --tail=100
```

### Prometheus Metrics

Access Prometheus at `http://your-domain:9090`

#### Key Metrics to Monitor

- **Application Metrics:**
  - `http_requests_total` - Total HTTP requests
  - `http_request_duration_seconds` - Request latency
  - `auth_logins_total` - Authentication events
  - `booking_transactions_total` - Booking transactions

- **System Metrics:**
  - `container_cpu_usage_seconds_total` - Container CPU usage
  - `container_memory_usage_bytes` - Container memory usage
  - `nginx_http_requests_total` - Nginx request metrics

- **Custom Business Metrics:**
  - `bookings_created_total` - New bookings
  - `payments_processed_total` - Payment transactions
  - `user_sessions_active` - Active user sessions

### Grafana Dashboards

Access Grafana at `http://your-domain:3001`

Default login: `admin` / `your-grafana-password`

#### Pre-configured Dashboards

1. **System Overview** - Overall system health and performance
2. **Application Metrics** - Application-specific metrics
3. **Business Metrics** - Key business KPIs
4. **Error Monitoring** - Error rates and patterns

### Log Management

#### Log Locations

```bash
# Application logs
docker logs boka-app
docker logs boka-worker

# Nginx logs
docker logs boka-nginx

# System logs
sudo journalctl -u boka -f

# Application file logs (if configured)
tail -f /opt/boka/logs/app.log
tail -f /opt/boka/logs/error.log
```

#### Log Rotation

```bash
# Configure logrotate
sudo nano /etc/logrotate.d/boka
```

```
/opt/boka/logs/*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 644 root root
    postrotate
        docker kill -s USR1 boka-app
    endscript
}
```

### Alerting

#### Grafana Alerts

Configure alerts in Grafana for:
- High CPU/memory usage (>80%)
- Error rate increases (>5%)
- Failed authentication attempts (>10/min)
- Database connection failures
- Payment processing failures

#### Email Notifications

Configure SMTP in Grafana:
```yaml
smtp:
  enabled: true
  host: smtp.gmail.com:587
  user: your-email@gmail.com
  password: your-app-password
  from_address: alerts@your-domain.com
```

## Backup & Recovery

### Automated Backups

The backup script runs automatically via cron:

```bash
# Edit crontab
sudo crontab -e

# Add backup schedules
0 2 * * * /opt/boka/deployment/scripts/backup.sh daily
0 3 * * 0 /opt/boka/deployment/scripts/backup.sh weekly
0 4 1 * * /opt/boka/deployment/scripts/backup.sh monthly
```

### Manual Backup

```bash
# Run manual backup
/opt/boka/deployment/scripts/backup.sh daily

# Backup with verification
/opt/boka/deployment/scripts/backup.sh daily --verify
```

### Backup Components

1. **Application Code** - Source code and configurations
2. **Database Schema** - Supabase migrations and schema
3. **Docker Volumes** - Persistent data (Redis, logs, etc.)
4. **Configuration Files** - Environment variables, Nginx config, etc.

### Recovery Procedures

#### Application Recovery

```bash
# Stop services
cd /opt/boka/deployment
docker-compose down

# Restore from backup
tar -xzf /opt/backups/boka/daily/boka-daily-20240101-120000-app.tar.gz -C /opt/boka

# Restart services
docker-compose up -d
```

#### Database Recovery

```bash
# For Supabase, restore from SQL dump
gunzip < backup-db.sql.gz | psql -h your-supabase-host -U postgres -d your-database

# Run migrations if needed
npx supabase db push
```

#### Full System Recovery

1. **Provision new server** with same specifications
2. **Install dependencies** (Docker, etc.)
3. **Restore application** from backup
4. **Restore database** from backup
5. **Update DNS** to point to new server
6. **Verify functionality** with health checks

## Troubleshooting Guide

### Common Issues

#### Application Won't Start

**Symptoms:**
- Container exits immediately
- Error messages in logs
- Health check failures

**Diagnosis:**
```bash
# Check container status
docker-compose ps

# Check logs
docker logs boka-app --tail=100

# Check resource usage
docker stats

# Check environment variables
docker exec boka-app env | grep -E "(SUPABASE|NEXTAUTH|REDIS)"
```

**Solutions:**
1. Verify environment variables are set correctly
2. Check database connectivity
3. Ensure Redis is accessible
4. Verify sufficient disk space and memory
5. Check for port conflicts

#### Database Connection Issues

**Symptoms:**
- "Connection refused" errors
- Timeout errors
- Authentication failures

**Diagnosis:**
```bash
# Test database connection
curl -f "${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/health"

# Check network connectivity
nslookup your-supabase-host
telnet your-supabase-host 5432
```

**Solutions:**
1. Verify Supabase URL and keys
2. Check network connectivity
3. Verify firewall rules
4. Check Supabase project status

#### High Memory Usage

**Symptoms:**
- Slow response times
- Container restarts
- Out of memory errors

**Diagnosis:**
```bash
# Check memory usage
free -h
docker stats

# Check for memory leaks
docker exec boka-app node --expose-gc -e "global.gc(); console.log(process.memoryUsage())"
```

**Solutions:**
1. Increase server memory
2. Optimize application code
3. Implement memory limits
4. Add swap space (temporary)

#### SSL Certificate Issues

**Symptoms:**
- "Certificate expired" errors
- "Invalid certificate" warnings
- HTTPS not working

**Diagnosis:**
```bash
# Check certificate expiry
openssl x509 -in /opt/boka/deployment/nginx/ssl/cert.pem -noout -dates

# Test SSL configuration
curl -I https://your-domain.com
```

**Solutions:**
1. Renew SSL certificate
2. Verify certificate chain
3. Check Nginx configuration
4. Restart Nginx container

### Performance Issues

#### Slow Response Times

**Investigation Steps:**
1. Check system resources (CPU, memory, disk)
2. Review application metrics in Grafana
3. Analyze slow query logs
4. Check Redis performance
5. Review Nginx access logs

**Optimization Strategies:**
1. Enable Redis caching
2. Optimize database queries
3. Implement CDN for static assets
4. Scale horizontally (multiple app containers)
5. Tune Nginx configuration

#### Database Performance

**Monitoring:**
```sql
-- Check active connections
SELECT count(*) FROM pg_stat_activity;

-- Check slow queries
SELECT query, mean_time, calls 
FROM pg_stat_statements 
ORDER BY mean_time DESC 
LIMIT 10;

-- Check table sizes
SELECT schemaname,tablename,
pg_size_pretty(size) AS size_pretty,
pg_size_pretty(total_size) AS total_size_pretty
FROM (SELECT schemaname,tablename,
      pg_relation_size(schemaname||'.'||tablename) AS size,
      pg_total_relation_size(schemaname||'.'||tablename) AS total_size
      FROM pg_tables) AS TABLES
ORDER BY total_size DESC;
```

**Optimization:**
1. Add missing indexes
2. Optimize query patterns
3. Implement connection pooling
4. Consider read replicas

### Error Investigation

#### Application Errors

```bash
# Real-time error monitoring
docker logs -f boka-app | grep -i error

# Error patterns
docker logs boka-app --since="1h" | grep -E "(ERROR|WARN)" | sort | uniq -c | sort -nr

# Application metrics
curl http://localhost:3000/api/metrics | grep error
```

#### System Errors

```bash
# System logs
sudo journalctl -u boka --since="1 hour ago" | grep -i error

# Docker daemon logs
sudo journalctl -u docker --since="1 hour ago"

# Disk space issues
df -h
docker system df
```

## Security Procedures

### Security Monitoring

#### Authentication Monitoring

```bash
# Check failed login attempts
docker exec boka-app npm run script:check-failed-logins

# Monitor MFA usage
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/api/admin/security/mfa-stats"

# Check locked accounts
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/api/admin/security/locked-accounts"
```

#### Access Log Analysis

```bash
# Suspicious IP patterns
docker logs boka-nginx | awk '{print $1}' | sort | uniq -c | sort -nr | head -20

# Failed authentication attempts
docker logs boka-app | grep "authentication failed" | tail -20

# SQL injection attempts
docker logs boka-nginx | grep -i "union\|select\|drop\|delete" | tail -10
```

### Security Updates

#### Regular Security Tasks

1. **Weekly:**
   - Review security alerts
   - Check failed authentication logs
   - Verify SSL certificate status
   - Review user access logs

2. **Monthly:**
   - Update system packages
   - Review security configurations
   - Audit user permissions
   - Test backup and recovery

3. **Quarterly:**
   - Security audit
   - Penetration testing
   - Review and update security policies
   - Staff security training

#### Emergency Security Response

1. **Security Incident Detection:**
   - Monitor security alerts
   - Check system logs
   - Review user reports

2. **Immediate Response:**
   - Isolate affected systems
   - Change compromised credentials
   - Enable additional logging
   - Document incident

3. **Investigation:**
   - Analyze logs and evidence
   - Determine scope of breach
   - Identify attack vectors
   - Assess data impact

4. **Recovery:**
   - Patch vulnerabilities
   - Restore clean backups if needed
   - Update security measures
   - Monitor for persistence

### Access Control

#### Admin Access

```bash
# Create admin user
docker exec boka-app npm run script:create-admin -- \
  --email admin@yourcompany.com \
  --password SecurePassword123! \
  --role superadmin

# List admin users
docker exec boka-app npm run script:list-admins

# Revoke admin access
docker exec boka-app npm run script:revoke-admin -- \
  --email compromised@yourcompany.com
```

#### API Key Management

```bash
# List active API keys
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/api/admin/api-keys"

# Revoke compromised API key
curl -X DELETE \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/api/admin/api-keys/{key_id}"

# Generate emergency admin API key
docker exec boka-app npm run script:generate-emergency-key
```

## Maintenance Tasks

### Daily Maintenance

#### Automated (via cron)
- Health checks
- Log rotation
- Metric collection
- Backup verification

#### Manual Checks
- Review system metrics
- Check error logs
- Verify backups completed
- Monitor disk space

### Weekly Maintenance

1. **System Updates:**
```bash
# Update system packages
sudo apt update && sudo apt list --upgradable
sudo apt upgrade -y

# Update Docker images
cd /opt/boka/deployment
docker-compose pull
docker-compose up -d
```

2. **Database Maintenance:**
```bash
# Check database stats
docker exec boka-app npm run script:db-stats

# Cleanup old sessions
docker exec boka-app npm run script:cleanup-sessions

# Vacuum database (if using PostgreSQL directly)
docker exec postgres-container psql -U postgres -c "VACUUM ANALYZE;"
```

3. **Security Review:**
```bash
# Review failed login attempts
docker exec boka-app npm run script:security-report

# Check for vulnerabilities
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  aquasec/trivy image boka-app:latest
```

### Monthly Maintenance

1. **Performance Review:**
   - Analyze system metrics
   - Review slow queries
   - Check resource utilization
   - Plan capacity upgrades

2. **Backup Testing:**
```bash
# Test backup restoration
/opt/boka/deployment/scripts/backup.sh daily
# Restore to test environment
# Verify data integrity
```

3. **Certificate Management:**
```bash
# Check SSL certificate expiry
openssl x509 -in /opt/boka/deployment/nginx/ssl/cert.pem -noout -dates

# Renew Let's Encrypt certificates
sudo certbot renew --dry-run
```

### Quarterly Maintenance

1. **Security Audit:**
   - Review user permissions
   - Update security configurations
   - Test incident response procedures
   - Update documentation

2. **Disaster Recovery Testing:**
   - Test full system recovery
   - Verify backup integrity
   - Update recovery procedures
   - Train operations team

3. **Capacity Planning:**
   - Analyze growth trends
   - Plan infrastructure upgrades
   - Review cost optimization
   - Update monitoring thresholds

## Emergency Procedures

### System Down

#### Immediate Response (RTO: 15 minutes)

1. **Assess the situation:**
```bash
# Quick system check
systemctl status boka
docker-compose -f /opt/boka/deployment/docker-compose.yml ps
```

2. **Attempt automatic recovery:**
```bash
# Restart services
sudo systemctl restart boka

# If that fails, manual restart
cd /opt/boka/deployment
docker-compose down
docker-compose up -d
```

3. **Check for immediate issues:**
```bash
# Check logs
docker logs boka-app --tail=50
docker logs boka-nginx --tail=50

# Check resources
df -h
free -h
```

#### If Automatic Recovery Fails

1. **Switch to maintenance mode:**
```bash
# Update Nginx to serve maintenance page
cp /opt/boka/deployment/nginx/maintenance.html /var/www/html/
# Update Nginx config to serve maintenance page
```

2. **Investigate the root cause:**
   - Check system resources
   - Review error logs
   - Check external dependencies
   - Verify configuration

3. **Manual recovery steps:**
   - Restore from backup if needed
   - Fix configuration issues
   - Restart services
   - Verify functionality

### Data Corruption

#### Response Steps

1. **Stop all write operations:**
```bash
# Stop application
docker stop boka-app boka-worker

# Enable read-only mode if possible
```

2. **Assess damage:**
   - Identify affected data
   - Determine scope of corruption
   - Check backup integrity

3. **Recovery process:**
   - Restore from clean backup
   - Apply incremental changes if possible
   - Verify data integrity
   - Resume normal operations

### Security Incident

#### Immediate Response (RTO: 5 minutes)

1. **Isolate the system:**
```bash
# Block suspicious IPs
sudo iptables -A INPUT -s SUSPICIOUS_IP -j DROP

# Force logout all users
docker exec boka-app npm run script:force-logout-all
```

2. **Preserve evidence:**
   - Snapshot current system state
   - Copy relevant logs
   - Document timeline

3. **Assess impact:**
   - Check for data breaches
   - Verify system integrity
   - Identify attack vectors

#### Recovery Steps

1. **Secure the system:**
   - Change all passwords
   - Revoke API keys
   - Update security configurations
   - Apply security patches

2. **Restore clean state:**
   - Restore from clean backup
   - Verify system integrity
   - Update monitoring

3. **Post-incident:**
   - Conduct full investigation
   - Update security procedures
   - Train staff on lessons learned

### Performance Crisis

#### High Load Response

1. **Immediate scaling:**
```bash
# Scale app containers
docker-compose -f /opt/boka/deployment/docker-compose.yml up -d --scale boka-app=3

# Enable Redis caching aggressively
docker exec boka-app npm run script:enable-aggressive-caching
```

2. **Load shedding:**
   - Enable rate limiting
   - Disable non-essential features
   - Prioritize critical functions

3. **Resource optimization:**
   - Kill non-essential processes
   - Optimize database queries
   - Clear unnecessary caches

### Communication Templates

#### Status Page Updates

```
🔴 INCIDENT: System Experiencing Issues
We are currently investigating connectivity issues affecting our booking system. 
New bookings may be delayed. We apologize for any inconvenience.
Status: Investigating
ETA: 30 minutes
Last updated: [timestamp]
```

#### Customer Notification

```
Subject: Service Disruption - Boka Booking System

Dear Valued Customer,

We are currently experiencing technical difficulties that may affect your ability to 
access our booking system. Our technical team is working to resolve this issue as 
quickly as possible.

Expected resolution: [time]
Alternative contact: [phone/email]

We sincerely apologize for any inconvenience this may cause.

Best regards,
Boka Support Team
```

## Contact Information

### Emergency Contacts

- **Primary On-Call**: [phone] / [email]
- **Secondary On-Call**: [phone] / [email]
- **Technical Lead**: [phone] / [email]
- **Infrastructure Team**: [email]

### Escalation Path

1. **Level 1**: On-call engineer
2. **Level 2**: Senior engineer + Technical lead
3. **Level 3**: CTO + Infrastructure team
4. **Level 4**: Executive team

### External Vendors

- **Hosting Provider**: [contact]
- **SSL Certificate**: [contact]
- **Monitoring Service**: [contact]
- **Database Provider (Supabase)**: [contact]

---

*This operations guide should be reviewed and updated quarterly. Last updated: [date]*