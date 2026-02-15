#!/bin/bash

# Webhook-triggered deployment script for Tu-Link Backend
# Called by the webhook listener when GitHub Actions sends a deploy request
# Usage: ./webhook-deploy.sh <environment> [git-ref] [git-sha]

ENVIRONMENT=${1:-dev}
GIT_REF=${2:-}
GIT_SHA=${3:-}
BACKEND_DIR="/opt/tulink-backend"
LOG_FILE="/var/log/tulink-deploy.log"

log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

error() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] [ERROR] $1" | tee -a "$LOG_FILE"
    exit 1
}

# Quick validation and immediate response to webhook
if [[ ! "$ENVIRONMENT" =~ ^(dev|staging|prod)$ ]]; then
    error "Invalid environment: $ENVIRONMENT"
fi

if [[ ! -d "$BACKEND_DIR" ]]; then
    error "Backend directory $BACKEND_DIR not found"
fi

# Return immediately to webhook caller and continue deployment in background
echo "Deployment request accepted - running in background"
echo "Check deployment logs at: $LOG_FILE"

# Background deployment function
deploy_in_background() {
    set -e
    
    log "=== Webhook deploy triggered for environment: $ENVIRONMENT ==="
    log "Git ref: ${GIT_REF:-not specified}"
    log "Git SHA: ${GIT_SHA:-not specified}"

    # Navigate to project directory
    cd "$BACKEND_DIR" || error "Backend directory $BACKEND_DIR not found"

    # Determine branch from environment
    case $ENVIRONMENT in
        "dev") BRANCH="dev" ;;
        "staging") BRANCH="staging" ;;
        "prod") BRANCH="main" ;;
    esac

    # Pull latest code
    log "Pulling latest code from $BRANCH..."
    git fetch origin "$BRANCH"
    git checkout "$BRANCH"
    git reset --hard "origin/$BRANCH"

    log "Current commit: $(git log --oneline -1)"

    # Run the existing deploy script
    log "Running deploy-caddy.sh $ENVIRONMENT..."
    bash deployment/scripts/deploy-caddy.sh "$ENVIRONMENT" 2>&1 | tee -a "$LOG_FILE"

    log "=== Webhook deploy completed successfully ==="
}

# Run deployment in background with proper error handling
deploy_in_background > "$LOG_FILE" 2>&1 &

# Get the background process PID and log it
DEPLOY_PID=$!
log "Deployment started in background with PID: $DEPLOY_PID"
