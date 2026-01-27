#!/bin/bash

# Tu-Link Backend Deployment Script
# Usage: ./scripts/deploy.sh [dev|staging|prod]

set -e  # Exit on any error

ENVIRONMENT=${1:-dev}
PROJECT_DIR="/opt/tulink"
DOCKER_IMAGE="tulink/backend"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(dev|staging|prod)$ ]]; then
    error "Invalid environment. Use: dev, staging, or prod"
    exit 1
fi

# Set environment-specific variables
case $ENVIRONMENT in
    "dev")
        DOMAIN="api.dev.tulink.xyz"
        DOCKER_TAG="dev"
        COMPOSE_FILE="docker-compose.dev.yml"
        ENV_FILE=".env.development"
        BRANCH="dev"
        ;;
    "staging")
        DOMAIN="api.staging.tulink.xyz"
        DOCKER_TAG="staging"
        COMPOSE_FILE="docker-compose.staging.yml"
        ENV_FILE=".env.staging"
        BRANCH="stage"
        ;;
    "prod")
        DOMAIN="api.tulink.xyz"
        DOCKER_TAG="prod"
        COMPOSE_FILE="docker-compose.prod.yml"
        ENV_FILE=".env.production"
        BRANCH="prod"
        ;;
esac

log "Starting deployment to $ENVIRONMENT environment"
log "Domain: $DOMAIN"
log "Docker tag: $DOCKER_TAG"

# Pre-deployment checks
log "Running pre-deployment checks..."

# Check if required files exist
if [[ ! -f "$ENV_FILE" ]]; then
    error "Environment file $ENV_FILE not found"
    exit 1
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
    error "Docker compose file $COMPOSE_FILE not found"
    exit 1
fi

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    error "Docker is not running"
    exit 1
fi

# Git operations
log "Checking git status..."
if [[ -n $(git status --porcelain) ]]; then
    warn "There are uncommitted changes in the repository"
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

log "Pulling latest changes from $BRANCH branch..."
git fetch origin
git checkout $BRANCH
git pull origin $BRANCH

# Build and deploy
log "Building Docker image..."
docker build -t $DOCKER_IMAGE:$DOCKER_TAG .

# Stop existing containers
log "Stopping existing containers..."
docker-compose -f $COMPOSE_FILE down || true

# Start new containers
log "Starting new containers..."
docker-compose -f $COMPOSE_FILE up -d

# Wait for services to be ready
log "Waiting for services to start..."
sleep 30

# Health check
log "Performing health check..."
MAX_RETRIES=10
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if curl -f -s "https://$DOMAIN/health" > /dev/null; then
        success "Health check passed"
        break
    else
        warn "Health check failed, retrying... ($((RETRY_COUNT + 1))/$MAX_RETRIES)"
        sleep 10
        RETRY_COUNT=$((RETRY_COUNT + 1))
    fi
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    error "Health check failed after $MAX_RETRIES attempts"
    exit 1
fi

# Cleanup old images
log "Cleaning up old Docker images..."
docker image prune -f

# Display container status
log "Container status:"
docker-compose -f $COMPOSE_FILE ps

success "Deployment to $ENVIRONMENT completed successfully!"
log "Application is available at: https://$DOMAIN"
log "API Documentation: https://$DOMAIN/api/docs"