#!/bin/bash

# Tu-Link Backend Deployment Script for Caddy Setup
# Usage: ./deployment/scripts/deploy-caddy.sh [prod|staging|dev]

set -e

ENVIRONMENT=${1:-prod}
BACKEND_DIR="/opt/tulink-backend"
CADDY_DIR="/opt/tulink-traefik"

# Colors
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
    exit 1
}

success() {
    echo -e "${GREEN}[SUCCESS] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[WARNING] $1${NC}"
}

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(dev|staging|prod)$ ]]; then
    error "Invalid environment. Use: dev, staging, or prod"
fi

# Set environment-specific variables
case $ENVIRONMENT in
    "dev")
        COMPOSE_FILE="config/docker/docker-compose.dev.yml"
        ENV_FILE=".env.development"
        CONTAINER_NAME="tulink-backend-dev"
        DOMAIN="api.dev.tulink.xyz"
        ;;
    "staging")
        COMPOSE_FILE="config/docker/docker-compose.staging.yml"
        ENV_FILE=".env.staging"
        CONTAINER_NAME="tulink-backend-staging"
        DOMAIN="api.staging.tulink.xyz"
        ;;
    "prod")
        COMPOSE_FILE="config/docker/docker-compose.caddy.yml"
        ENV_FILE=".env.production"
        CONTAINER_NAME="tulink-backend-prod"
        DOMAIN="api.tulink.xyz"
        ;;
esac

log "Starting deployment to $ENVIRONMENT environment"

# Check if we're in the backend directory
if [[ ! -f "package.json" ]]; then
    error "Not in backend directory. Please run from the tulink-backend root directory."
fi

# Pre-deployment checks
log "Running pre-deployment checks..."

if [[ ! -f "$ENV_FILE" ]]; then
    error "Environment file $ENV_FILE not found"
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
    error "Docker compose file $COMPOSE_FILE not found"
fi

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    error "Docker is not running"
fi

# Check if Caddy network exists
if ! docker network inspect traefik-network > /dev/null 2>&1; then
    warn "Caddy network 'traefik-network' not found. Creating it..."
    docker network create traefik-network
fi

# Git operations (if in git repo)
if git rev-parse --git-dir > /dev/null 2>&1; then
    log "Pulling latest changes..."
    # Determine current branch
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
    git pull origin $CURRENT_BRANCH || warn "Failed to pull latest changes"
fi

# Stop existing containers
log "Stopping existing containers..."
docker compose -f $COMPOSE_FILE down --remove-orphans || true

# Remove old container if exists
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    log "Removing old container: $CONTAINER_NAME"
    docker rm -f $CONTAINER_NAME
fi

# Build and start new containers
log "Building and starting containers..."
docker compose -f $COMPOSE_FILE up -d --build

# Wait for services to be ready
log "Waiting for services to start..."
sleep 30

# Health check
log "Performing health check..."
MAX_RETRIES=12
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if docker exec $CONTAINER_NAME curl -f -s http://localhost:3000/health > /dev/null 2>&1; then
        success "Internal health check passed"
        break
    else
        warn "Internal health check failed, retrying... ($((RETRY_COUNT + 1))/$MAX_RETRIES)"
        sleep 5
        RETRY_COUNT=$((RETRY_COUNT + 1))
    fi
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    error "Internal health check failed after $MAX_RETRIES attempts"
fi

# Check external health through Caddy
log "Checking external health through Caddy..."
sleep 10

RETRY_COUNT=0
while [ $RETRY_COUNT -lt 5 ]; do
    if curl -f -s https://$DOMAIN/health > /dev/null 2>&1; then
        success "External health check passed through Caddy ($DOMAIN)"
        break
    else
        warn "External health check failed for $DOMAIN, retrying... ($((RETRY_COUNT + 1))/5)"
        sleep 10
        RETRY_COUNT=$((RETRY_COUNT + 1))
    fi
done

if [ $RETRY_COUNT -eq 5 ]; then
    warn "External health check failed for $DOMAIN. Check Caddy configuration."
fi

# Reload Caddy configuration
if [ -d "$CADDY_DIR" ]; then
    log "Reloading Caddy configuration..."
    cd $CADDY_DIR
    docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile || warn "Failed to reload Caddy config"
    cd - > /dev/null
fi

# Cleanup old images
log "Cleaning up old Docker images..."
docker image prune -f

# Display container status
log "Container status:"
docker compose -f $COMPOSE_FILE ps

# Show logs
log "Recent logs:"
docker compose -f $COMPOSE_FILE logs --tail=20 tulink-backend

success "Deployment to $ENVIRONMENT completed successfully!"

log "🌐 $ENVIRONMENT Environment URLs:"
log "   API: https://$DOMAIN"
log "   API Documentation: https://$DOMAIN/api"
log "   Health Check: https://$DOMAIN/health"

if [ "$ENVIRONMENT" = "dev" ]; then
    log "   Direct Access: http://localhost:3001 (for development)"
fi

log "Deployment completed at $(date)"