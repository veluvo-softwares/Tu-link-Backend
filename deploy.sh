#!/bin/bash

# Tu-Link Backend - Simple Dev Deployment Script
# Usage: ./deploy.sh

set -e

echo "🚀 Starting Tu-Link Backend deployment..."

# Pull latest changes
echo "📥 Pulling latest changes..."
git pull origin dev

# Stop any running containers
echo "🛑 Stopping existing containers..."
docker compose -f config/docker/docker-compose.dev.yml down || true

# Build and start
echo "🔨 Building and starting application..."
docker compose -f config/docker/docker-compose.dev.yml up -d --build

# Wait for services to be ready
echo "⏳ Waiting for services to start..."
sleep 15

# Health check
echo "🏥 Checking application health..."
for i in {1..10}; do
    if curl -f -s http://localhost:3000/health > /dev/null 2>&1; then
        echo "✅ Application is healthy!"
        break
    fi
    echo "⏳ Waiting for app... (attempt $i/10)"
    sleep 5
done

# Show status
echo "📊 Container status:"
docker compose -f config/docker/docker-compose.dev.yml ps

echo ""
echo "🎉 Deployment complete!"
echo "📍 API Health: http://localhost:3000/health"
echo "📚 API Docs: http://localhost:3000/api"
echo "🔍 Logs: docker compose -f config/docker/docker-compose.dev.yml logs -f"