#!/bin/bash

# Simple deployment script for tulink-backend
# Usage: ./deploy.sh [dev|staging|prod]

set -e

ENVIRONMENT=${1:-dev}

echo "🚀 Starting simple deployment for $ENVIRONMENT environment..."

# Pull latest changes
echo "📥 Pulling latest changes..."
git pull origin $ENVIRONMENT

# Stop containers
echo "🛑 Stopping containers..."
docker compose -f config/docker/docker-compose.$ENVIRONMENT.yml down || true

# Build and start containers
echo "🔨 Building and starting containers..."
docker compose -f config/docker/docker-compose.$ENVIRONMENT.yml up -d --build

# Wait for startup
echo "⏳ Waiting for containers to start..."
sleep 30

# Check status
echo "📊 Container status:"
docker compose -f config/docker/docker-compose.$ENVIRONMENT.yml ps

echo "✅ Deployment complete!"
echo "🌐 API: https://api.$ENVIRONMENT.tulink.xyz/health"