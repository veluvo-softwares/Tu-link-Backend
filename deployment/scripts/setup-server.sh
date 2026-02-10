#!/bin/bash

# Tu-Link Server Setup Script for Digital Ocean Droplet
# Usage: ./scripts/setup-server.sh [environment]

set -e

ENVIRONMENT=${1:-dev}
PROJECT_DIR="/opt/tulink"

# Colors for output
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
}

success() {
    echo -e "${GREEN}[SUCCESS] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[WARNING] $1${NC}"
}

# Check if running as root
if [[ $EUID -ne 0 ]]; then
    error "This script must be run as root"
    exit 1
fi

log "Setting up Tu-Link server for $ENVIRONMENT environment"

# Update system
log "Updating system packages..."
apt update && apt upgrade -y

# Install Docker
log "Installing Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
    systemctl start docker
    systemctl enable docker
    success "Docker installed successfully"
else
    success "Docker is already installed"
fi

# Install Docker Compose
log "Installing Docker Compose..."
if ! command -v docker-compose &> /dev/null; then
    curl -L "https://github.com/docker/compose/releases/download/v2.24.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
    success "Docker Compose installed successfully"
else
    success "Docker Compose is already installed"
fi

# Install Nginx
log "Installing Nginx..."
if ! command -v nginx &> /dev/null; then
    apt install -y nginx
    systemctl start nginx
    systemctl enable nginx
    success "Nginx installed successfully"
else
    success "Nginx is already installed"
fi

# Install Certbot for SSL
log "Installing Certbot for SSL certificates..."
if ! command -v certbot &> /dev/null; then
    apt install -y certbot python3-certbot-nginx
    success "Certbot installed successfully"
else
    success "Certbot is already installed"
fi

# Install Git
log "Installing Git..."
if ! command -v git &> /dev/null; then
    apt install -y git
    success "Git installed successfully"
else
    success "Git is already installed"
fi

# Install Node.js (for local development tools)
log "Installing Node.js..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
    success "Node.js installed successfully"
else
    success "Node.js is already installed"
fi

# Create project directory
log "Creating project directory..."
mkdir -p $PROJECT_DIR/$ENVIRONMENT
chown -R root:root $PROJECT_DIR

# Set up firewall
log "Configuring firewall..."
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw allow 80
ufw allow 443
ufw --force enable

# Create deployment user
log "Creating deployment user..."
if ! id "deploy" &>/dev/null; then
    useradd -m -s /bin/bash deploy
    usermod -aG docker deploy
    mkdir -p /home/deploy/.ssh
    chown deploy:deploy /home/deploy/.ssh
    chmod 700 /home/deploy/.ssh
    success "Deploy user created successfully"
else
    success "Deploy user already exists"
fi

# Set environment-specific configurations
case $ENVIRONMENT in
    "dev")
        DOMAIN="api.dev.tulink.xyz"
        ;;
    "staging")
        DOMAIN="api.staging.tulink.xyz"
        ;;
    "prod")
        DOMAIN="api.tulink.xyz"
        ;;
    *)
        error "Invalid environment: $ENVIRONMENT"
        exit 1
        ;;
esac

# Create basic Nginx configuration
log "Creating basic Nginx configuration for $DOMAIN..."
cat > /etc/nginx/sites-available/$DOMAIN << EOF
server {
    listen 80;
    server_name $DOMAIN;
    
    location / {
        return 301 https://\$server_name\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name $DOMAIN;
    
    # Placeholder SSL configuration - will be updated by Certbot
    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

# Enable the site (without SSL first)
ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# Install SSL certificate
log "Installing SSL certificate for $DOMAIN..."
if [[ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]]; then
    success "SSL certificate already exists for $DOMAIN"
else
    warn "Please run the following command to get SSL certificate:"
    echo "certbot --nginx -d $DOMAIN"
    echo ""
    warn "After getting the certificate, replace the Nginx configuration with the one from nginx/conf.d/tulink.conf"
fi

# Clone repository
log "Setting up repository..."
cd $PROJECT_DIR/$ENVIRONMENT
if [[ ! -d ".git" ]]; then
    git clone https://github.com/MrNyamu/tulink-backend.git .
    git checkout $ENVIRONMENT
    success "Repository cloned successfully"
else
    success "Repository already exists"
fi

# Create environment file template
log "Creating environment file template..."
if [[ ! -f ".env" ]]; then
    cp .env.example .env
    warn "Please configure .env file with your environment-specific settings"
else
    success "Environment file already exists"
fi

# Set up log rotation
log "Setting up log rotation..."
cat > /etc/logrotate.d/tulink << EOF
$PROJECT_DIR/*/logs/*.log {
    daily
    missingok
    rotate 52
    compress
    notifempty
    create 0644 deploy deploy
    postrotate
        docker-compose -f $PROJECT_DIR/$ENVIRONMENT/docker-compose.$ENVIRONMENT.yml restart tulink-backend || true
    endscript
}
EOF

# Create systemd service for auto-start (optional)
log "Creating systemd service..."
cat > /etc/systemd/system/tulink-$ENVIRONMENT.service << EOF
[Unit]
Description=Tu-Link Backend ($ENVIRONMENT)
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$PROJECT_DIR/$ENVIRONMENT
ExecStart=/usr/local/bin/docker-compose -f docker-compose.$ENVIRONMENT.yml up -d
ExecStop=/usr/local/bin/docker-compose -f docker-compose.$ENVIRONMENT.yml down
TimeoutStartSec=0
User=deploy
Group=deploy

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable tulink-$ENVIRONMENT.service

success "Server setup completed for $ENVIRONMENT environment!"
log "Next steps:"
echo "1. Configure SSL certificate: certbot --nginx -d $DOMAIN"
echo "2. Update .env file: $PROJECT_DIR/$ENVIRONMENT/.env"
echo "3. Replace Nginx config with production version"
echo "4. Start the application: systemctl start tulink-$ENVIRONMENT"
echo "5. Check status: systemctl status tulink-$ENVIRONMENT"