# Deployment Troubleshooting Guide

Common deployment issues and their solutions for TuLink Backend.

## 🚨 Critical Issues

### Application Won't Start

#### Symptoms
- Container exits immediately
- "Application failed to start" in logs
- Port binding failures

#### Causes & Solutions

**🔧 Port Already in Use**
```bash
# Check what's using the port
sudo netstat -tulpn | grep :3000
# or
sudo lsof -i :3000

# Kill process if necessary
sudo kill -9 PID_NUMBER

# Restart container
docker restart CONTAINER_ID
```

**🔧 Environment Variables Missing**
```bash
# Check container environment
docker exec CONTAINER_ID env | grep NODE_ENV
docker exec CONTAINER_ID env | grep FIREBASE

# Fix: Update environment variables and restart
```

**🔧 Dependency Issues**
```bash
# Check package.json changes
git diff HEAD~1 package.json

# Rebuild container if dependencies changed
docker build -t tulink-backend .
docker stop CONTAINER_ID
docker run -d --name new-backend tulink-backend
```

### Database Connection Failures

#### Symptoms
- "Unable to connect to Firebase" errors
- Authentication failures on startup
- Firestore timeout errors

#### Solutions

**🔧 Firebase Configuration**
```bash
# Verify Firebase credentials
docker exec CONTAINER_ID cat /path/to/firebase-key.json

# Check Firebase project ID
docker logs CONTAINER_ID | grep "Firebase"

# Restart with fresh credentials if needed
```

**🔧 Network Connectivity**
```bash
# Test Firebase connectivity from container
docker exec CONTAINER_ID curl -I https://firestore.googleapis.com

# Test DNS resolution
docker exec CONTAINER_ID nslookup firestore.googleapis.com
```

### Redis Connection Issues

#### Symptoms
- "Redis client error" in logs
- Location caching failures
- Session management problems

#### Solutions

**🔧 Redis Service Check**
```bash
# Check Redis container status
docker ps | grep redis

# Test Redis connection
docker exec REDIS_CONTAINER redis-cli ping
# Should return: PONG

# Check Redis logs
docker logs REDIS_CONTAINER --tail=20
```

**🔧 Redis Configuration**
```bash
# Verify Redis host/port in app
docker exec BACKEND_CONTAINER env | grep REDIS

# Test connection from backend container
docker exec BACKEND_CONTAINER telnet redis-host 6379
```

## ⚠️ Warning Issues

### Performance Degradation

#### Symptoms
- Slow response times
- High memory usage
- CPU spikes

#### Solutions

**🔧 Memory Issues**
```bash
# Check container resource usage
docker stats CONTAINER_ID

# Check Node.js memory usage
docker exec CONTAINER_ID node -e "console.log(process.memoryUsage())"

# Restart container to clear memory leaks
docker restart CONTAINER_ID
```

**🔧 Database Query Performance**
```bash
# Check slow queries in logs
docker logs CONTAINER_ID | grep -i "slow\|timeout"

# Monitor Firebase quota usage
# Check Firebase Console → Usage tab
```

### Authentication Problems

#### Symptoms
- Users can't log in
- Token validation failures
- Permission denied errors

#### Solutions

**🔧 Firebase Auth Issues**
```bash
# Check Firebase Auth configuration
docker logs CONTAINER_ID | grep -i "auth\|firebase"

# Verify Firebase project settings
# Check Firebase Console → Authentication → Settings

# Test auth endpoint manually
curl -X POST https://your-api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"testpass"}'
```

**🔧 JWT Token Issues**
```bash
# Check JWT configuration in container
docker exec CONTAINER_ID env | grep JWT

# Verify token expiration settings
# Check application configuration files
```

## 🔄 Git/Deployment Issues

### Git Pull Failures

#### Symptoms
- "Repository not found" errors
- Permission denied during git operations
- Merge conflicts on server

#### Solutions

**🔧 Authentication Issues**
```bash
# Check SSH key on server
ssh-add -l

# Verify repository access
git remote -v
git ls-remote origin

# Re-authenticate if necessary
ssh-keygen -t rsa -b 4096 -C "server@your-domain"
# Add public key to GitHub
```

**🔧 Merge Conflicts**
```bash
# Check for conflicts
git status

# Resolve conflicts (backup first)
cp -r . ../backup-$(date +%Y%m%d)

# Option 1: Hard reset to remote
git fetch origin
git reset --hard origin/main

# Option 2: Merge manually
git pull --no-rebase origin main
# Resolve conflicts and commit
```

### Docker Container Issues

#### Symptoms
- Container keeps restarting
- "No space left on device" errors
- Container becomes unresponsive

#### Solutions

**🔧 Disk Space Issues**
```bash
# Check disk usage
df -h
docker system df

# Clean up Docker resources
docker system prune -f
docker image prune -f
docker volume prune -f

# Remove old containers
docker container prune -f
```

**🔧 Container Health Issues**
```bash
# Check container health
docker inspect CONTAINER_ID | grep Health -A 10

# Review container resource limits
docker inspect CONTAINER_ID | grep -A 10 "Resources"

# Check if container is in restart loop
docker logs CONTAINER_ID --tail=50
```

## 🔧 Diagnostic Commands

### System Health Check
```bash
#!/bin/bash
echo "=== SYSTEM HEALTH CHECK ==="

# Disk space
echo "📁 Disk Usage:"
df -h | head -5

# Memory usage
echo "🧠 Memory Usage:"
free -h

# Docker status
echo "🐳 Docker Status:"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Application logs (last 10 lines)
echo "📋 Recent Application Logs:"
docker logs CONTAINER_ID --tail=10

# Network connectivity
echo "🌐 Network Check:"
curl -s -o /dev/null -w "Health endpoint: %{http_code}\n" https://your-api/health
```

### Performance Diagnostics
```bash
#!/bin/bash
echo "=== PERFORMANCE DIAGNOSTICS ==="

# CPU usage
echo "💻 CPU Usage:"
top -bn1 | grep "Cpu(s)"

# Memory breakdown
echo "📊 Memory Breakdown:"
docker exec CONTAINER_ID cat /proc/meminfo | head -5

# Active connections
echo "🔌 Active Connections:"
netstat -an | grep :3000 | grep ESTABLISHED | wc -l

# Response time test
echo "⏱️ Response Time Test:"
curl -w "@curl-format.txt" -s -o /dev/null https://your-api/health
```

### Log Analysis Commands
```bash
# Recent errors only
docker logs CONTAINER_ID --since="1h" 2>&1 | grep -i error

# Performance-related logs
docker logs CONTAINER_ID --since="30m" 2>&1 | grep -i "slow\|timeout\|memory"

# Authentication logs
docker logs CONTAINER_ID --since="1h" 2>&1 | grep -i "auth\|login\|token"

# Database-related logs
docker logs CONTAINER_ID --since="1h" 2>&1 | grep -i "firebase\|firestore\|redis"
```

## 📋 Issue Resolution Workflow

### 1. Immediate Assessment
```bash
# Quick health check
curl -I https://your-api/health

# Check container status
docker ps | grep backend

# Review recent logs
docker logs CONTAINER_ID --tail=20
```

### 2. Identify Root Cause
```bash
# Check resource usage
docker stats CONTAINER_ID --no-stream

# Review error patterns
docker logs CONTAINER_ID | grep -i error | tail -5

# Test key endpoints
curl -X POST https://your-api/auth/login -d '{"test":"data"}'
```

### 3. Apply Fix
```bash
# Simple restart (fixes ~60% of issues)
docker restart CONTAINER_ID

# Environment fix
# Edit environment variables and restart

# Code fix
git pull origin main
docker restart CONTAINER_ID
```

### 4. Verify Resolution
```bash
# Wait for startup
sleep 30

# Verify functionality
curl https://your-api/health
curl -X POST https://your-api/auth/login -d '{"email":"test","password":"test"}'

# Monitor for 5 minutes
watch -n 30 "docker logs CONTAINER_ID --tail=1"
```

## 📞 Escalation Procedures

### Level 1: Self-Service (0-15 minutes)
- Check obvious issues (disk space, container status)
- Restart container
- Review recent logs
- Test basic functionality

### Level 2: Team Support (15-30 minutes)
- Engage team in chat
- Share diagnostic output
- Review recent deployments
- Consider rollback

### Level 3: Critical Escalation (30+ minutes)
- Alert on-call engineer
- Implement emergency rollback
- Document incident
- Prepare post-mortem

## 🔒 Security Issues

### Suspicious Activity
```bash
# Check for unusual login attempts
docker logs CONTAINER_ID | grep -i "login\|auth" | grep -v "200"

# Monitor failed authentication
docker logs CONTAINER_ID | grep "401\|403"

# Check for unusual API usage
docker logs CONTAINER_ID | grep -E "POST|PUT|DELETE" | tail -20
```

### Data Breach Response
1. **Immediate**: Disable affected user accounts
2. **Document**: Capture all relevant logs
3. **Notify**: Alert security team and stakeholders
4. **Investigate**: Full security audit
5. **Remediate**: Apply security patches

---

## 📚 Additional Resources

- [Deployment Process](./backend-deployment.md)
- [Environment Setup](../development/environment-setup.md)
- [Monitoring Guidelines](../monitoring/health-checks.md)
- [Security Protocols](../security/incident-response.md)

---

*Keep this guide updated with new issues and solutions as they arise.*