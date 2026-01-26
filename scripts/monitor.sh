#!/bin/bash

# Tu-Link Monitoring Script
# Usage: ./scripts/monitor.sh [environment]

set -e

ENVIRONMENT=${1:-prod}
PROJECT_DIR="/opt/tulink"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

error() {
    echo -e "${RED}[ERROR] $1${NC}"
}

success() {
    echo -e "${GREEN}[SUCCESS] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[WARNING] $1${NC}"
}

# Set environment-specific variables
case $ENVIRONMENT in
    "dev")
        DOMAIN="api.dev.tulink.xyz"
        COMPOSE_FILE="docker-compose.dev.yml"
        ;;
    "staging")
        DOMAIN="api.staging.tulink.xyz"
        COMPOSE_FILE="docker-compose.staging.yml"
        ;;
    "prod")
        DOMAIN="api.tulink.xyz"
        COMPOSE_FILE="docker-compose.prod.yml"
        ;;
    *)
        error "Invalid environment: $ENVIRONMENT"
        exit 1
        ;;
esac

log "Monitoring Tu-Link $ENVIRONMENT environment"
log "Domain: $DOMAIN"

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    error "Docker is not running"
    exit 1
fi

# Container status
log "Container Status:"
docker-compose -f "$PROJECT_DIR/$ENVIRONMENT/$COMPOSE_FILE" ps

# Health checks
log "Performing health checks..."

# API health check
if curl -f -s "https://$DOMAIN/health" > /dev/null; then
    success "API is healthy"
else
    error "API health check failed"
fi

# Redis health check
REDIS_STATUS=$(docker-compose -f "$PROJECT_DIR/$ENVIRONMENT/$COMPOSE_FILE" exec -T redis redis-cli ping 2>/dev/null || echo "FAILED")
if [[ "$REDIS_STATUS" == "PONG" ]]; then
    success "Redis is healthy"
else
    error "Redis health check failed"
fi

# Nginx status
if systemctl is-active --quiet nginx; then
    success "Nginx is running"
else
    error "Nginx is not running"
fi

# Disk usage
log "Disk Usage:"
df -h | grep -E "^/dev|^Filesystem"

# Memory usage
log "Memory Usage:"
free -h

# Docker stats
log "Docker Resource Usage:"
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.BlockIO}}"

# Recent logs (last 50 lines)
log "Recent application logs:"
docker-compose -f "$PROJECT_DIR/$ENVIRONMENT/$COMPOSE_FILE" logs --tail=50 tulink-backend

# SSL certificate check (if in production)
if [[ "$ENVIRONMENT" == "prod" ]]; then
    log "Checking SSL certificate..."
    CERT_EXPIRY=$(echo | openssl s_client -servername $DOMAIN -connect $DOMAIN:443 2>/dev/null | openssl x509 -noout -enddate | cut -d= -f2)
    CERT_EXPIRY_TIMESTAMP=$(date -d "$CERT_EXPIRY" +%s)
    CURRENT_TIMESTAMP=$(date +%s)
    DAYS_UNTIL_EXPIRY=$(( (CERT_EXPIRY_TIMESTAMP - CURRENT_TIMESTAMP) / 86400 ))
    
    if [[ $DAYS_UNTIL_EXPIRY -gt 30 ]]; then
        success "SSL certificate expires in $DAYS_UNTIL_EXPIRY days"
    elif [[ $DAYS_UNTIL_EXPIRY -gt 7 ]]; then
        warn "SSL certificate expires in $DAYS_UNTIL_EXPIRY days - consider renewal"
    else
        error "SSL certificate expires in $DAYS_UNTIL_EXPIRY days - URGENT renewal needed"
    fi
fi

# Network connectivity test
log "Testing external connectivity..."
if ping -c 1 google.com > /dev/null 2>&1; then
    success "External network connectivity is working"
else
    error "External network connectivity failed"
fi

# Service ports
log "Service Ports:"
netstat -tlnp | grep -E ":80|:443|:3000|:6379"

log "Monitoring check completed"