# Backend Deployment Process

A comprehensive guide for deploying TuLink Backend updates to production servers.

## 📋 Overview

This process covers the complete deployment workflow from local development to production server updates.

## 🔧 Prerequisites

### Local Environment
- Git repository access with appropriate permissions
- GitHub CLI (`gh`) installed and authenticated
- SSH access to production server
- Administrative privileges for repository (for bypassing PR rules if needed)

### Server Environment
- Docker containers running the backend services
- Git repository cloned on the server
- Appropriate file permissions for git operations

## 🚀 Deployment Process

### Phase 1: Local Development & Testing

#### 1.1 Stash Current Changes
```bash
# Stage all changes and stash them
git add .
git stash
```
**Purpose**: Preserve work-in-progress changes safely before branching.

#### 1.2 Create Feature Branch
```bash
# Create a new branch for your changes
git checkout -b feature/your-feature-name
```
**Naming Convention**: `feature/`, `fix/`, `hotfix/`, or `enhancement/`

#### 1.3 Apply and Commit Changes
```bash
# Apply stashed changes to the new branch
git stash pop

# Stage all files
git add .

# Commit with conventional commit format
git commit -m "feat: implement your feature description

- Bullet point describing change 1
- Bullet point describing change 2
- Include impact and technical details

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

**Commit Message Guidelines**:
- Header max 72 characters
- Use conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`
- Include detailed body with bullet points
- Mention breaking changes if any

#### 1.4 Push to Remote
```bash
# Push branch to origin
git push -u origin feature/your-feature-name
```

### Phase 2: Pull Request & Review

#### 2.1 Create Pull Request
```bash
# Create PR with comprehensive description
gh pr create --title "🚀 Your Feature Title" --body "$(cat <<'EOF'
## 📋 Summary
Brief description of what this PR accomplishes.

## ✨ Key Features
- Feature 1: Description
- Feature 2: Description

## 🔧 Technical Implementation
### Changes Made
- File 1: Description of changes
- File 2: Description of changes

## 🧪 Testing & Verification
- ✅ TypeScript compilation passes
- ✅ ESLint passes with no warnings
- ✅ All tests pass
- ✅ Manual testing completed

## 🚨 Breaking Changes
List any breaking changes (if applicable)

## 📚 Documentation
List any documentation updates needed

---
**Ready for:** Testing and deployment
**Impact:** [High/Medium/Low]
**Risk:** [High/Medium/Low]

🤖 Generated with [Claude Code](https://claude.ai/code)
EOF
)"
```

#### 2.2 Merge Pull Request
```bash
# Option 1: Normal merge (if no branch protection rules)
gh pr merge PR_NUMBER --squash --delete-branch

# Option 2: Admin merge (bypass protection rules)
gh pr merge PR_NUMBER --squash --delete-branch --admin
```

#### 2.3 Update Local Main Branch
```bash
# Switch to main and pull latest
git checkout main
git pull origin main
```

### Phase 3: Server Deployment

#### 3.1 Access Production Server
```bash
# SSH into production server
ssh -o StrictHostKeyChecking=no user@your-server-ip

# Navigate to application directory
cd /path/to/tulink-backend
```

**Security Note**: Replace `user@your-server-ip` with actual credentials stored securely.

#### 3.2 Fetch and Apply Updates
```bash
# Fetch latest changes from remote
git fetch

# Pull and rebase changes (preserves local commits if any)
git pull --rebase origin main

# Alternative: Force update if clean deployment needed
# git reset --hard origin/main
```

#### 3.3 Restart Services
```bash
# Find running containers
docker ps

# Restart specific backend container
docker restart CONTAINER_ID

# Alternative: Restart by container name
# docker restart tulink-backend-api
```

#### 3.4 Verify Deployment
```bash
# Check container logs for startup issues
docker logs CONTAINER_ID --tail=50

# Monitor in real-time if needed
# docker logs -f CONTAINER_ID
```

### Phase 4: Post-Deployment Testing

#### 4.1 Health Check
```bash
# Test basic endpoint connectivity
curl -s https://your-api-domain/health

# Expect: HTTP 200 with health status
```

#### 4.2 Authentication Test
```bash
# Test authentication endpoint
curl -X POST https://your-api-domain/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"invalid"}' \
  -w "\n%{http_code}\n" -s

# Expect: HTTP 401 for invalid credentials
```

#### 4.3 API Functionality Test
```bash
# Test other critical endpoints as needed
curl -X GET https://your-api-domain/api/endpoint \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -w "\n%{http_code}\n" -s
```

## 🔍 Log Analysis

### Container Startup Logs
Look for these indicators of successful startup:
```
✅ Good Signs:
- "Nest application successfully started"
- "Tu-link Backend is running on: http://localhost:3000"
- "Redis client connected"
- Route mapping messages

❌ Warning Signs:
- Connection timeout errors
- Firebase authentication failures
- Database connection issues
- Port binding failures
```

### Common Log Patterns
```bash
# Filter for errors only
docker logs CONTAINER_ID 2>&1 | grep -i error

# Filter for specific service
docker logs CONTAINER_ID 2>&1 | grep -i "firebase\|redis\|auth"

# Check last 100 lines with timestamps
docker logs CONTAINER_ID --timestamps --tail=100
```

## 🚨 Rollback Procedure

If deployment fails and rollback is needed:

### Quick Rollback
```bash
# On server, revert to previous commit
git log --oneline -5  # Find previous commit hash
git reset --hard PREVIOUS_COMMIT_HASH
docker restart CONTAINER_ID
```

### Complete Rollback with New Deploy
```bash
# Locally, create rollback branch
git checkout main
git checkout -b hotfix/rollback-FEATURE_NAME
git revert COMMIT_HASH
git push -u origin hotfix/rollback-FEATURE_NAME

# Create and merge rollback PR
gh pr create --title "🔄 Rollback: Feature Name"
gh pr merge --squash --admin

# Deploy rollback following normal process
```

## 📊 Environment Variables

Common environment variables to verify on server:
```bash
# Check critical environment variables
echo $NODE_ENV
echo $PORT
echo $FIREBASE_PROJECT_ID
echo $REDIS_HOST

# Note: Never log sensitive values like API keys or passwords
```

## 🔒 Security Checklist

- [ ] All commits signed/verified
- [ ] No sensitive data in commit history
- [ ] Environment variables properly configured
- [ ] SSL certificates valid
- [ ] Firewall rules appropriate
- [ ] Container running with non-root user (when possible)
- [ ] Regular security updates applied

## ⚡ Quick Reference Commands

```bash
# Complete deployment in one session
git add . && git stash
git checkout -b feature/NAME && git stash pop
git add . && git commit -m "feat: DESCRIPTION"
git push -u origin feature/NAME
gh pr create && gh pr merge --squash --admin
git checkout main && git pull

# Server update
ssh user@server "cd app && git fetch && git pull --rebase origin main"
ssh user@server "docker restart CONTAINER_ID"

# Verify
curl -s https://api/health
```

## 📞 Support

For deployment issues:
1. Check container logs first
2. Verify environment variables
3. Test network connectivity
4. Review recent commits for breaking changes
5. Consult troubleshooting guide in `../troubleshooting/`

---

*This process ensures safe, reliable deployments while maintaining security and audit trails.*