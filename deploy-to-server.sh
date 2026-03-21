#!/bin/bash

# Tu-Link Backend - Dev Environment Server Deployment
# Run this script on your DigitalOcean server

set -e

# Configuration  
APP_DIR="/root/tulink-backend"
REPO_URL="https://github.com/veluvo-softwares/Tu-link-Backend.git"
BRANCH="dev"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log() { echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $1"; }
warn() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] WARNING:${NC} $1"; }
error() { echo -e "${RED}[$(date '+%H:%M:%S')] ERROR:${NC} $1"; exit 1; }

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    error "This script must be run as root"
fi

log "🚀 Starting Tu-Link Backend DEV deployment..."

# Check Docker
if ! docker info > /dev/null 2>&1; then
    error "Docker is not running. Please start Docker first."
fi

# Check traefik network
# if ! docker network ls | grep -q "traefik-network"; then
#     error "traefik-network not found. Please ensure existing infrastructure is running."
# fi

# Setup app directory
log "📁 Setting up application directory..."
mkdir -p "$APP_DIR"
cd "$APP_DIR"

# Clone or update repo
if [ -d ".git" ]; then
    log "📥 Updating repository..."
    git fetch origin
    git reset --hard origin/$BRANCH
else
    log "📥 Cloning repository..."
    git clone --branch "$BRANCH" "$REPO_URL" .
fi

# Setup environment
if [ ! -f ".env" ]; then
    log "⚙️  Creating .env file..."
    cp .env.example .env
    warn "Edit .env with your credentials: nano .env"
    warn "Press Enter when ready..."
    read
fi

# Deploy using existing dev config
log "🛑 Stopping existing containers..."
docker compose -f config/docker/docker-compose.dev.yml down || true

log "🔨 Building and starting dev environment..."
docker compose -f config/docker/docker-compose.dev.yml up -d --build

log "⏳ Waiting for startup..."
sleep 15

# Health check
log "🏥 Health check..."
for i in {1..10}; do
    if curl -f -s http://localhost:3000/health > /dev/null 2>&1; then
        log "✅ Application healthy!"
        break
    fi
    log "⏳ Attempt $i/10..."
    sleep 5
done

# Show status
log "📊 Container status:"
docker compose -f config/docker/docker-compose.dev.yml ps

echo ""
log "🎉 Dev deployment complete!"
log "🌐 Public API: https://api.dev.tulink.xyz"
log "🌐 Local API: http://localhost:3000"
log "📚 Docs: https://api.dev.tulink.xyz/api"  
log "🔍 Logs: docker compose -f config/docker/docker-compose.dev.yml logs -f"