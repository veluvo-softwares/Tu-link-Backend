#!/bin/bash

# Development Deployment Script for TuLink Backend
# This script deploys the application to the development environment

set -e

echo "🚀 Starting TuLink Backend Development Deployment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if we're in the right directory
if [ ! -f "package.json" ] || [ ! -d "config/docker" ]; then
    print_error "This script must be run from the tulink-backend root directory"
    exit 1
fi

# Check if .env file exists
if [ ! -f ".env" ]; then
    print_warning ".env file not found. Make sure to create one with required environment variables."
fi

# Create logs directory if it doesn't exist
mkdir -p logs

print_status "Stopping any existing containers..."
docker compose -f config/docker/docker-compose.dev.yml down --remove-orphans

print_status "Building and starting development containers..."
docker compose -f config/docker/docker-compose.dev.yml up -d --build

print_status "Waiting for containers to start..."
sleep 15

# Wait for application to be ready
print_status "Checking application health..."
for i in {1..5}; do
    if curl -f -s http://localhost:3000/health > /dev/null 2>&1; then
        print_success "Application is healthy!"
        break
    fi
    if [ $i -eq 5 ]; then
        print_error "Health check failed after 5 attempts"
        print_status "Container logs:"
        docker compose -f config/docker/docker-compose.dev.yml logs api-dev
        exit 1
    fi
    print_status "Health check attempt $i/5 failed, retrying in 15s..."
    sleep 15
done

# Show final status
print_status "Checking container status..."
docker compose -f config/docker/docker-compose.dev.yml ps

print_success "Development deployment completed successfully!"
print_status "Application is running at: http://localhost:3000"
print_status "Health check: http://localhost:3000/health"
print_status "API Documentation: http://localhost:3000/api"

echo ""
print_status "To view logs: docker compose -f config/docker/docker-compose.dev.yml logs -f"
print_status "To stop: docker compose -f config/docker/docker-compose.dev.yml down"