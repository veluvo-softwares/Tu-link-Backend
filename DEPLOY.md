# Simple Deployment Guide

## Quick Deployment

### On Droplet:
```bash
# Navigate to project
cd /opt/tulink-backend

# Deploy (pulls latest code, rebuilds, restarts)
./deploy.sh dev
```

### Environments:
- **Development**: `./deploy.sh dev`
- **Staging**: `./deploy.sh staging` 
- **Production**: `./deploy.sh prod`

## Manual Steps:
```bash
# Pull latest code
git pull origin dev

# Stop containers
docker compose -f config/docker/docker-compose.dev.yml down

# Start containers
docker compose -f config/docker/docker-compose.dev.yml up -d --build
```

## URLs:
- **Dev API**: https://api.dev.tulink.xyz
- **Staging API**: https://api.staging.tulink.xyz
- **Prod API**: https://api.tulink.xyz

## Logs:
```bash
# View logs
docker compose -f config/docker/docker-compose.dev.yml logs -f

# View specific service logs
docker logs tulink-backend-dev -f
```

## Health Check:
```bash
curl https://api.dev.tulink.xyz/health
```

That's it! No complex CI/CD, no webhooks, just simple and reliable.