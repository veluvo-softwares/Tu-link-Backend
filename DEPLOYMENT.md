# Tu-Link Backend Deployment Guide

This guide provides step-by-step instructions for deploying the Tu-Link Backend to a DigitalOcean droplet.

## Prerequisites

- DigitalOcean account with an active droplet
- Domain name pointed to your droplet IP
- GitHub repository access
- Local development environment set up

## Deployment Architecture

```
Internet → Nginx (80/443) → Docker Container (3000) → Redis (6379)
                ↓
            SSL/TLS
          (Let's Encrypt)
```

## Step 1: Prepare Your Droplet

### 1.1 Create a DigitalOcean Droplet

1. Log in to DigitalOcean
2. Create a new droplet:
   - **Image**: Ubuntu 22.04 LTS
   - **Size**: Minimum 2GB RAM / 2 vCPUs (Basic $12/month)
   - **Region**: Choose closest to your users
   - **Authentication**: SSH keys (recommended)
   - **Hostname**: `tulink-api`

### 1.2 Initial Server Setup

SSH into your droplet as root:

```bash
ssh root@your-droplet-ip
```

Run the automated setup script:

```bash
# Download and run the setup script
curl -O https://raw.githubusercontent.com/yourusername/tulink-backend/main/scripts/setup-droplet.sh
chmod +x setup-droplet.sh
sudo ./setup-droplet.sh
```

This script will:
- Update system packages
- Install Docker & Docker Compose
- Install Nginx
- Configure firewall (UFW)
- Set up fail2ban for SSH protection
- Create a deploy user
- Set up swap file (2GB)

### 1.3 Manual Post-Setup Tasks

1. **Add SSH Key for Deploy User**:
```bash
# Add your SSH public key to deploy user
echo "your-ssh-public-key" >> /home/deploy/.ssh/authorized_keys
```

2. **Secure SSH** (optional but recommended):
```bash
# Edit SSH config
sudo nano /etc/ssh/sshd_config

# Change these settings:
PermitRootLogin no
PasswordAuthentication no
Port 2222  # Change default port

# Restart SSH
sudo systemctl restart sshd
```

3. **Update firewall for new SSH port** (if changed):
```bash
sudo ufw allow 2222/tcp
sudo ufw delete allow 22/tcp
```

## Step 2: Configure Your Domain

### 2.1 DNS Configuration

Add these DNS records to your domain:

```
Type    Host    Value               TTL
A       api     your-droplet-ip     3600
AAAA    api     your-droplet-ipv6   3600  (if available)
```

### 2.2 Test DNS Resolution

```bash
# Should return your droplet IP
dig api.yourdomain.com
```

## Step 3: Set Up the Application

### 3.1 Clone Repository

SSH as deploy user:

```bash
ssh deploy@your-droplet-ip
cd /opt/tulink
git clone https://github.com/yourusername/tulink-backend.git .
```

### 3.2 Create Production Environment File

```bash
cp .env.production.example .env.production
nano .env.production
```

Update with your production values:

```env
NODE_ENV=production
PORT=3000

# Database
DB_HOST=your-db-host
DB_PASSWORD=your-secure-password

# Redis
REDIS_PASSWORD=your-redis-password

# JWT
JWT_SECRET=generate-32-char-secret
JWT_REFRESH_SECRET=another-32-char-secret

# Firebase (for push notifications)
FIREBASE_PROJECT_ID=your-project
FIREBASE_PRIVATE_KEY=your-key
FIREBASE_CLIENT_EMAIL=your-email

# Domain
API_DOMAIN=api.yourdomain.com
FRONTEND_URL=https://yourdomain.com
```

### 3.3 Set Up SSL Certificate

```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx

# Get SSL certificate
sudo certbot certonly --standalone -d api.yourdomain.com

# Copy certificates to nginx directory
sudo mkdir -p /opt/tulink/nginx/ssl
sudo cp /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem /opt/tulink/nginx/ssl/
sudo cp /etc/letsencrypt/live/api.yourdomain.com/privkey.pem /opt/tulink/nginx/ssl/
sudo cp /etc/letsencrypt/live/api.yourdomain.com/chain.pem /opt/tulink/nginx/ssl/

# Set up auto-renewal
sudo certbot renew --dry-run
```

## Step 4: Deploy with Docker

### 4.1 Build and Start Services

```bash
cd /opt/tulink

# Build the application
docker-compose -f docker-compose.prod.yml build

# Start all services
docker-compose -f docker-compose.prod.yml up -d

# Check status
docker-compose -f docker-compose.prod.yml ps

# View logs
docker-compose -f docker-compose.prod.yml logs -f
```

### 4.2 Verify Deployment

```bash
# Check health endpoint
curl https://api.yourdomain.com/health

# Check API docs
open https://api.yourdomain.com/api/docs

# Check container logs
docker logs tulink-backend-prod -f
```

## Step 5: Set Up GitHub Actions CI/CD

### 5.1 Generate Deployment SSH Key

On your local machine:

```bash
# Generate new SSH key pair for deployment
ssh-keygen -t ed25519 -f ~/.ssh/tulink-deploy -C "github-actions"

# Add public key to droplet
ssh-copy-id -i ~/.ssh/tulink-deploy.pub deploy@your-droplet-ip
```

### 5.2 Configure GitHub Secrets

Go to GitHub repository → Settings → Secrets → Actions

Add these secrets:

| Secret Name | Value |
|------------|-------|
| `DROPLET_HOST` | Your droplet IP address |
| `DROPLET_USERNAME` | `deploy` |
| `DROPLET_SSH_KEY` | Contents of `~/.ssh/tulink-deploy` (private key) |
| `DROPLET_PORT` | `22` (or your custom SSH port) |
| `SLACK_WEBHOOK` | Optional: Slack webhook URL for notifications |

### 5.3 Test Automated Deployment

```bash
# Push to main branch
git add .
git commit -m "Deploy to production"
git push origin main
```

Monitor deployment in GitHub Actions tab.

## Step 6: Monitoring and Maintenance

### 6.1 Set Up Monitoring

1. **Application Logs**:
```bash
# View application logs
docker logs tulink-backend-prod -f

# View Nginx logs
tail -f /opt/tulink/nginx/logs/tulink-api-access.log
tail -f /opt/tulink/nginx/logs/tulink-api-error.log
```

2. **System Monitoring**:
```bash
# Check system resources
htop

# Check Docker containers
docker stats

# Check disk usage
df -h
```

3. **Set Up External Monitoring** (recommended):
- UptimeRobot for uptime monitoring
- Sentry for error tracking
- New Relic or DataDog for APM

### 6.2 Backup Strategy

1. **Database Backups**:
```bash
# Create backup script
nano /opt/tulink/scripts/backup.sh

#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
docker exec postgres pg_dump -U user dbname > /backups/db_$DATE.sql
# Upload to S3 or DigitalOcean Spaces
```

2. **Redis Backups**:
```bash
# Redis persistence is enabled with AOF
# Backup the data directory
tar -czf redis_backup_$DATE.tar.gz /opt/tulink/redis_data
```

3. **Automate Backups**:
```bash
# Add to crontab
crontab -e

# Daily database backup at 3 AM
0 3 * * * /opt/tulink/scripts/backup.sh
```

### 6.3 Updates and Rollbacks

**To Update**:
```bash
cd /opt/tulink
git pull origin main
docker-compose -f docker-compose.prod.yml build
docker-compose -f docker-compose.prod.yml up -d
```

**To Rollback**:
```bash
# Revert to previous commit
git reset --hard HEAD~1

# Or checkout specific version
git checkout tags/v1.0.0

# Rebuild and restart
docker-compose -f docker-compose.prod.yml build
docker-compose -f docker-compose.prod.yml up -d
```

## Troubleshooting

### Container Won't Start

```bash
# Check logs
docker logs tulink-backend-prod

# Check environment variables
docker-compose -f docker-compose.prod.yml config

# Rebuild from scratch
docker-compose -f docker-compose.prod.yml down
docker system prune -a
docker-compose -f docker-compose.prod.yml up --build
```

### SSL Certificate Issues

```bash
# Renew certificate manually
sudo certbot renew --force-renewal

# Copy new certificates
sudo cp /etc/letsencrypt/live/api.yourdomain.com/*.pem /opt/tulink/nginx/ssl/

# Restart Nginx
docker-compose -f docker-compose.prod.yml restart nginx
```

### High Memory Usage

```bash
# Check memory usage
free -h

# Clear Docker cache
docker system prune -a

# Restart services
docker-compose -f docker-compose.prod.yml restart
```

### Database Connection Issues

```bash
# Check Redis connectivity
docker exec tulink-redis-prod redis-cli ping

# Check Redis password
docker exec tulink-redis-prod redis-cli -a your-password ping

# Check network
docker network ls
docker network inspect tulink-backend_tulink-network
```

## Security Checklist

- [ ] SSH key authentication enabled
- [ ] Root login disabled
- [ ] Firewall configured (UFW)
- [ ] Fail2ban protecting SSH
- [ ] SSL certificate installed and auto-renewing
- [ ] Environment variables secured
- [ ] Regular security updates scheduled
- [ ] Backup strategy implemented
- [ ] Monitoring alerts configured
- [ ] Rate limiting enabled in Nginx
- [ ] CORS properly configured
- [ ] Security headers implemented

## Support

For issues or questions:
1. Check application logs
2. Review this documentation
3. Check GitHub Issues
4. Contact the development team

## Quick Commands Reference

```bash
# SSH to server
ssh deploy@your-droplet-ip

# Navigate to project
cd /opt/tulink

# View running containers
docker ps

# Restart application
docker-compose -f docker-compose.prod.yml restart

# View logs
docker-compose -f docker-compose.prod.yml logs -f tulink-backend

# Update and redeploy
git pull && docker-compose -f docker-compose.prod.yml up -d --build

# Check health
curl https://api.yourdomain.com/health
```