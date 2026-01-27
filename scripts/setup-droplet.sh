#!/bin/bash

# DigitalOcean Droplet Setup Script for Tu-Link Backend
# This script sets up a fresh DigitalOcean droplet for Tu-Link deployment

set -e

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
    exit 1
}

success() {
    echo -e "${GREEN}[SUCCESS] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[WARNING] $1${NC}"
}

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
   error "Please run as root (use sudo)"
fi

log "Starting DigitalOcean droplet setup for Tu-Link Backend..."

# Update system packages
log "Updating system packages..."
apt-get update
apt-get upgrade -y

# Install essential packages
log "Installing essential packages..."
apt-get install -y \
    curl \
    wget \
    git \
    vim \
    htop \
    ufw \
    fail2ban \
    certbot \
    python3-certbot-nginx

# Install Docker
log "Installing Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
    systemctl enable docker
    systemctl start docker
    success "Docker installed successfully"
else
    warn "Docker is already installed"
fi

# Install Docker Compose
log "Installing Docker Compose..."
if ! command -v docker-compose &> /dev/null; then
    curl -L "https://github.com/docker/compose/releases/download/v2.24.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
    ln -s /usr/local/bin/docker-compose /usr/bin/docker-compose
    success "Docker Compose installed successfully"
else
    warn "Docker Compose is already installed"
fi

# Install Node.js (for running scripts)
log "Installing Node.js..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs
    success "Node.js installed successfully"
else
    warn "Node.js is already installed"
fi

# Install Nginx
log "Installing Nginx..."
if ! command -v nginx &> /dev/null; then
    apt-get install -y nginx
    systemctl enable nginx
    systemctl start nginx
    success "Nginx installed successfully"
else
    warn "Nginx is already installed"
fi

# Setup application directory
log "Setting up application directory..."
if [ ! -d "/opt/tulink" ]; then
    mkdir -p /opt/tulink
    success "Created /opt/tulink directory"
else
    warn "/opt/tulink directory already exists"
fi

# Setup logs directory
log "Setting up logs directory..."
mkdir -p /opt/tulink/logs
mkdir -p /opt/tulink/nginx/logs
mkdir -p /opt/tulink/nginx/conf.d
mkdir -p /opt/tulink/nginx/ssl

# Configure firewall
log "Configuring firewall..."
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3000/tcp  # For direct access during testing
echo "y" | ufw enable
success "Firewall configured"

# Configure fail2ban for SSH protection
log "Configuring fail2ban..."
systemctl enable fail2ban
systemctl start fail2ban

# Create deploy user
log "Creating deploy user..."
if ! id "deploy" &>/dev/null; then
    useradd -m -s /bin/bash deploy
    usermod -aG docker deploy
    mkdir -p /home/deploy/.ssh
    chmod 700 /home/deploy/.ssh
    touch /home/deploy/.ssh/authorized_keys
    chmod 600 /home/deploy/.ssh/authorized_keys
    chown -R deploy:deploy /home/deploy/.ssh
    chown -R deploy:deploy /opt/tulink
    success "Deploy user created"
    warn "Remember to add your SSH public key to /home/deploy/.ssh/authorized_keys"
else
    warn "Deploy user already exists"
fi

# Setup swap (recommended for small droplets)
log "Setting up swap file..."
if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' | tee -a /etc/fstab
    success "2GB swap file created"
else
    warn "Swap file already exists"
fi

# Clone the repository
log "Repository setup..."
cd /opt/tulink
if [ ! -d ".git" ]; then
    warn "Please clone your repository:"
    echo "  cd /opt/tulink"
    echo "  git clone https://github.com/yourusername/tulink-backend.git ."
    echo "  chown -R deploy:deploy /opt/tulink"
else
    success "Repository already exists"
fi

# Display next steps
echo ""
success "DigitalOcean Droplet setup completed!"
echo ""
log "Next steps:"
echo "1. Add your SSH public key to /home/deploy/.ssh/authorized_keys"
echo "2. Clone your repository to /opt/tulink"
echo "3. Create .env.production file in /opt/tulink"
echo "4. Configure Nginx for your domain"
echo "5. Set up SSL certificates with: certbot --nginx -d api.yourdomain.com"
echo "6. Configure GitHub secrets for deployment:"
echo "   - DROPLET_HOST: Your droplet IP"
echo "   - DROPLET_USERNAME: deploy"
echo "   - DROPLET_SSH_KEY: Your deployment SSH private key"
echo "   - DROPLET_PORT: 22"
echo ""
log "System information:"
docker --version
docker-compose --version
node --version
nginx -v
echo ""
log "Security notes:"
echo "- Firewall is enabled (UFW)"
echo "- Fail2ban is protecting SSH"
echo "- Remember to disable root SSH access"
echo "- Consider changing SSH port from 22"