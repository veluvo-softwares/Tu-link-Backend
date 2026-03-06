#!/bin/bash

# Simple deployment script for tulink-backend
# Usage: ./deploy.sh

set -e

echo "🚀 Starting deployment for development environment..."

# Pull latest changes
echo "📥 Pulling latest changes..."
git pull origin dev

# Stop containers
echo "🛑 Stopping containers..."
docker compose -f config/docker/docker-compose.dev.yml down || true

# Build and start containers
echo "🔨 Building and starting containers..."
docker compose -f config/docker/docker-compose.dev.yml up -d --build

# Wait for startup
echo "⏳ Waiting for containers to start..."
sleep 30

# Check status
echo "📊 Container status:"
docker compose -f config/docker/docker-compose.dev.yml ps

echo "✅ Deployment complete!"
echo "🌐 API: http://localhost:3000/health"