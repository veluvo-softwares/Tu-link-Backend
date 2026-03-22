#!/bin/bash

# Tu-Link Backend Deployment Script for DigitalOcean
# This script sets up the production environment on a fresh Ubuntu droplet

set -e

echo "🚀 Starting Tu-Link Backend deployment..."

# Configuration
APP_DIR="/opt/tulink-backend"
ENV_FILE="$APP_DIR/.env"
USER="tulink"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   print_error "This script must be run as root (use sudo)"
   exit 1
fi

# Update system
print_status "Updating system packages..."
apt-get update && apt-get upgrade -y

# Install required packages
print_status "Installing required packages..."
apt-get install -y \
    curl \
    wget \
    git \
    ufw \
    fail2ban \
    htop \
    nginx \
    certbot \
    python3-certbot-nginx

# Install Docker
print_status "Installing Docker..."
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
rm get-docker.sh

# Install Docker Compose
print_status "Installing Docker Compose..."
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# Create application user
print_status "Creating application user..."
if ! id "$USER" &>/dev/null; then
    useradd -m -s /bin/bash "$USER"
    usermod -aG docker "$USER"
fi

# Create application directory
print_status "Setting up application directory..."
mkdir -p "$APP_DIR"
chown "$USER:$USER" "$APP_DIR"

# Clone repository (if not exists)
if [ ! -d "$APP_DIR/.git" ]; then
    print_status "Cloning repository..."
    sudo -u "$USER" git clone https://github.com/MrNyamu/tulink-backend.git "$APP_DIR"
else
    print_status "Repository already exists, pulling latest changes..."
    cd "$APP_DIR"
    sudo -u "$USER" git pull origin main
fi

# Create environment file template
print_status "Creating environment file template..."
cat > "$ENV_FILE" << EOL
# Production Environment Configuration for Tu-Link Backend
NODE_ENV=production
PORT=3000

# Redis Configuration
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=change_this_redis_password_in_production

# Firebase Configuration (Get from Firebase Console)
FIREBASE_PROJECT_ID=your_firebase_project_id
FIREBASE_CLIENT_EMAIL=your_firebase_client_email
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----"

# Google Maps API Configuration
GOOGLE_MAPS_API_KEY=your_google_maps_api_key

# Logging Configuration
LOG_LEVEL=info

# WebSocket CORS Configuration
WS_CORS_ORIGIN=https://yourdomain.com
EOL

chown "$USER:$USER" "$ENV_FILE"
chmod 600 "$ENV_FILE"

# Configure firewall
print_status "Configuring firewall..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# Configure fail2ban
print_status "Configuring fail2ban..."
cat > /etc/fail2ban/jail.local << EOL
[DEFAULT]
bantime = 10m
findtime = 10m
maxretry = 5

[sshd]
enabled = true
port = ssh
logpath = %(sshd_log)s
backend = %(sshd_backend)s

[nginx-http-auth]
enabled = true

[nginx-limit-req]
enabled = true
filter = nginx-limit-req
action = iptables-multiport[name=ReqLimit, port="http,https", protocol=tcp]
logpath = /var/log/nginx/*error.log
findtime = 600
bantime = 7200
maxretry = 10
EOL

systemctl enable fail2ban
systemctl start fail2ban

# Create logs directory
print_status "Creating logs directory..."
mkdir -p "$APP_DIR/logs"
chown "$USER:$USER" "$APP_DIR/logs"

# Set up logrotate
print_status "Setting up log rotation..."
cat > /etc/logrotate.d/tulink-backend << EOL
$APP_DIR/logs/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 $USER $USER
    sharedscripts
    postrotate
        docker-compose -f $APP_DIR/docker-compose.prod.yml restart app
    endscript
}
EOL

# Create systemd service for automatic startup
print_status "Creating systemd service..."
cat > /etc/systemd/system/tulink-backend.service << EOL
[Unit]
Description=Tu-Link Backend Docker Compose Service
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$APP_DIR
ExecStart=/usr/local/bin/docker-compose -f docker-compose.prod.yml up -d
ExecStop=/usr/local/bin/docker-compose -f docker-compose.prod.yml down
TimeoutStartSec=0
User=$USER
Group=$USER

[Install]
WantedBy=multi-user.target
EOL

systemctl daemon-reload
systemctl enable tulink-backend.service

# Set up monitoring script
print_status "Setting up health monitoring..."
cat > /usr/local/bin/tulink-health-check.sh << 'EOL'
#!/bin/bash
HEALTH_URL="http://localhost:3000/health"
LOG_FILE="/var/log/tulink-health.log"

if ! curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
    echo "$(date): Health check failed, restarting service..." >> "$LOG_FILE"
    systemctl restart tulink-backend.service
    sleep 30
    if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
        echo "$(date): Service restarted successfully" >> "$LOG_FILE"
    else
        echo "$(date): Service restart failed" >> "$LOG_FILE"
    fi
fi
EOL

chmod +x /usr/local/bin/tulink-health-check.sh

# Add health check to crontab
print_status "Setting up health check cron job..."
(crontab -l 2>/dev/null; echo "*/5 * * * * /usr/local/bin/tulink-health-check.sh") | crontab -

# Print completion message
print_status "Deployment setup completed!"
echo ""
echo "📋 Next steps:"
echo "1. Edit $ENV_FILE with your actual configuration values"
echo "2. Place your Firebase service account key at $APP_DIR/firebase-adminsdk.json"
echo "3. Start the application:"
echo "   cd $APP_DIR"
echo "   sudo -u $USER docker-compose -f docker-compose.prod.yml up -d"
echo ""
echo "4. (Optional) Set up SSL certificate:"
echo "   certbot --nginx -d yourdomain.com"
echo ""
echo "🔧 Management commands:"
echo "   Start:   sudo systemctl start tulink-backend"
echo "   Stop:    sudo systemctl stop tulink-backend"
echo "   Status:  sudo systemctl status tulink-backend"
echo "   Logs:    sudo -u $USER docker-compose -f $APP_DIR/docker-compose.prod.yml logs -f"
echo ""
echo "🌐 Access your application:"
echo "   Health Check: http://$(curl -s ifconfig.me)/health"
echo "   API Docs:     http://$(curl -s ifconfig.me)/api"
echo ""
print_warning "Remember to configure your environment variables in $ENV_FILE before starting the application!"