#!/bin/bash

# Tu-Link Backup Script
# Usage: ./scripts/backup.sh [environment] [type]
# Types: config, data, logs, full

set -e

ENVIRONMENT=${1:-prod}
BACKUP_TYPE=${2:-config}
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR="/opt/backups/tulink"
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

# Validate inputs
if [[ ! "$ENVIRONMENT" =~ ^(dev|staging|prod)$ ]]; then
    error "Invalid environment. Use: dev, staging, or prod"
    exit 1
fi

if [[ ! "$BACKUP_TYPE" =~ ^(config|data|logs|full)$ ]]; then
    error "Invalid backup type. Use: config, data, logs, or full"
    exit 1
fi

# Create backup directory
mkdir -p "$BACKUP_DIR/$ENVIRONMENT"

log "Starting $BACKUP_TYPE backup for $ENVIRONMENT environment"

case $BACKUP_TYPE in
    "config")
        log "Backing up configuration files..."
        BACKUP_FILE="$BACKUP_DIR/$ENVIRONMENT/config_${TIMESTAMP}.tar.gz"
        
        tar -czf "$BACKUP_FILE" \
            -C "$PROJECT_DIR/$ENVIRONMENT" \
            .env \
            docker-compose.*.yml \
            nginx/conf.d/ \
            package.json \
            package-lock.json \
            2>/dev/null || true
        
        success "Configuration backup saved to: $BACKUP_FILE"
        ;;
        
    "data")
        log "Backing up application data..."
        BACKUP_FILE="$BACKUP_DIR/$ENVIRONMENT/data_${TIMESTAMP}.tar.gz"
        
        # Stop containers to ensure consistent backup
        docker-compose -f "$PROJECT_DIR/$ENVIRONMENT/docker-compose.$ENVIRONMENT.yml" stop
        
        # Backup Redis data and any persistent volumes
        tar -czf "$BACKUP_FILE" \
            -C "$PROJECT_DIR/$ENVIRONMENT" \
            redis_data/ \
            logs/ \
            uploads/ \
            2>/dev/null || true
        
        # Restart containers
        docker-compose -f "$PROJECT_DIR/$ENVIRONMENT/docker-compose.$ENVIRONMENT.yml" start
        
        success "Data backup saved to: $BACKUP_FILE"
        ;;
        
    "logs")
        log "Backing up log files..."
        BACKUP_FILE="$BACKUP_DIR/$ENVIRONMENT/logs_${TIMESTAMP}.tar.gz"
        
        tar -czf "$BACKUP_FILE" \
            -C "$PROJECT_DIR/$ENVIRONMENT" \
            logs/ \
            nginx/logs/ \
            2>/dev/null || true
        
        success "Logs backup saved to: $BACKUP_FILE"
        ;;
        
    "full")
        log "Performing full backup..."
        BACKUP_FILE="$BACKUP_DIR/$ENVIRONMENT/full_${TIMESTAMP}.tar.gz"
        
        # Stop containers for consistent backup
        docker-compose -f "$PROJECT_DIR/$ENVIRONMENT/docker-compose.$ENVIRONMENT.yml" stop
        
        # Create full backup excluding unnecessary files
        tar -czf "$BACKUP_FILE" \
            --exclude="node_modules" \
            --exclude=".git" \
            --exclude="*.tmp" \
            --exclude="*.log.gz" \
            -C "$PROJECT_DIR" \
            "$ENVIRONMENT"
        
        # Restart containers
        docker-compose -f "$PROJECT_DIR/$ENVIRONMENT/docker-compose.$ENVIRONMENT.yml" start
        
        success "Full backup saved to: $BACKUP_FILE"
        ;;
esac

# Get backup file size
BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
log "Backup size: $BACKUP_SIZE"

# Cleanup old backups (keep last 30 days)
log "Cleaning up old backups..."
find "$BACKUP_DIR/$ENVIRONMENT" -name "*_*.tar.gz" -mtime +30 -delete 2>/dev/null || true

# List recent backups
log "Recent backups:"
ls -lh "$BACKUP_DIR/$ENVIRONMENT" | tail -5

success "Backup completed successfully!"