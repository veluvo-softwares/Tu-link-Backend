# Rollback Procedure

Emergency rollback procedures for TuLink Backend deployments when issues occur in production.

## 🚨 When to Rollback

### Immediate Rollback Required
- **Critical functionality broken** (users can't login, core features down)
- **High error rate** (>5% of requests failing)
- **Security vulnerability** introduced
- **Data corruption** detected
- **Performance degradation** (response times >10x normal)
- **Complete service outage**

### Consider Rollback
- **Non-critical feature issues** 
- **UI/UX problems** affecting user experience
- **Third-party integration failures**
- **Monitoring/logging issues**

## ⚡ Quick Rollback (Emergency)

### 1. Server-Side Rollback (5 minutes)
```bash
# SSH to production server
ssh user@production-server

# Navigate to application directory
cd /path/to/tulink-backend

# Check recent commits to identify rollback target
git log --oneline -5

# Find the last known good commit (usually previous to current)
git log --oneline | head -10

# Hard reset to previous commit
git reset --hard PREVIOUS_COMMIT_HASH

# Restart application container
docker restart CONTAINER_ID

# Verify rollback
curl -s https://your-api-domain/health
```

### 2. Verification Steps
```bash
# Check application startup
docker logs CONTAINER_ID --tail=30

# Test critical endpoints
curl -X POST https://your-api-domain/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"invalid"}' \
  -w "\n%{http_code}\n"
# Should return 401

# Monitor error rates for 5 minutes
docker logs CONTAINER_ID --since="5m" | grep -i error | wc -l
```

## 🔄 Proper Rollback Process

### 1. Create Rollback Branch
```bash
# From local development machine
git checkout main
git pull origin main

# Create rollback branch
git checkout -b hotfix/rollback-FEATURE_NAME

# Identify commit to revert
git log --oneline -10

# Revert the problematic commit(s)
git revert COMMIT_HASH

# If multiple commits, revert in reverse order
git revert COMMIT_3
git revert COMMIT_2  
git revert COMMIT_1

# Push rollback branch
git push -u origin hotfix/rollback-FEATURE_NAME
```

### 2. Create Emergency PR
```bash
# Create pull request for rollback
gh pr create --title "🔄 EMERGENCY ROLLBACK: Feature Name" --body "$(cat <<'EOF'
## 🚨 Emergency Rollback

**Reason for Rollback**: [Brief description of issue]
**Impact**: [Critical/High/Medium]
**Affected Systems**: [List affected components]

## Issues Identified
- Issue 1: Description
- Issue 2: Description

## Commits Being Reverted
- `COMMIT_HASH`: Commit description
- `COMMIT_HASH`: Commit description

## Verification Plan
- [ ] Health endpoint responding
- [ ] Authentication working
- [ ] Core functionality restored
- [ ] Error rates normalized

## Post-Rollback Actions
- [ ] Incident report creation
- [ ] Root cause analysis
- [ ] Fix development in separate branch
- [ ] Testing enhancement

**Urgency**: IMMEDIATE - Production impact
**Tested**: Emergency rollback procedure verified
EOF
)"

# Fast-track merge with admin privileges
gh pr merge --admin --squash --delete-branch
```

### 3. Deploy Rollback
```bash
# SSH to production server
ssh user@production-server

# Navigate to application directory  
cd /path/to/tulink-backend

# Fetch latest changes
git fetch origin

# Pull rollback changes
git pull origin main

# Restart application
docker restart CONTAINER_ID

# Monitor startup
docker logs CONTAINER_ID --tail=50 --follow
```

## 📊 Database Rollback Considerations

### Firebase/Firestore
```bash
# Firestore doesn't support automatic rollbacks
# Manual data restoration may be required

# Check for data consistency issues
# Review recent writes to critical collections:
# - users
# - journeys  
# - locations
# - notifications

# If data corruption detected:
# 1. Export affected collections
# 2. Restore from backup (if available)
# 3. Document data inconsistencies
```

### Redis Cache
```bash
# Redis data is typically ephemeral, but verify:

# Check Redis connection
docker exec REDIS_CONTAINER redis-cli ping

# Clear cache if data structure changed
docker exec REDIS_CONTAINER redis-cli FLUSHALL

# Restart Redis if needed
docker restart REDIS_CONTAINER
```

## 🔍 Post-Rollback Verification

### 1. Functional Testing
```bash
#!/bin/bash
echo "🔍 Starting post-rollback verification..."

# Health check
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" https://your-api/health)
echo "Health endpoint: $HEALTH"

# Authentication test  
AUTH=$(curl -s -o /dev/null -w "%{http_code}" -X POST https://your-api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test","password":"test"}')
echo "Authentication: $AUTH"

# Core API endpoints
JOURNEYS=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" \
  https://your-api/journeys)
echo "Journeys endpoint: $JOURNEYS"

if [[ $HEALTH -eq 200 && $AUTH -eq 401 ]]; then
    echo "✅ Basic functionality restored"
else
    echo "❌ Issues still present - investigate immediately"
fi
```

### 2. Performance Monitoring
```bash
# Monitor response times for 15 minutes
for i in {1..15}; do
    RESPONSE_TIME=$(curl -w "%{time_total}" -s -o /dev/null https://your-api/health)
    echo "Minute $i: ${RESPONSE_TIME}s response time"
    sleep 60
done

# Check error rates
ERROR_COUNT=$(docker logs CONTAINER_ID --since="15m" | grep -i error | wc -l)
echo "Errors in last 15 minutes: $ERROR_COUNT"
```

### 3. User Impact Assessment
```bash
# Check recent user activity
docker logs CONTAINER_ID --since="15m" | grep -i "login\|auth" | wc -l

# Monitor for user complaints
# Check support channels, social media, app store reviews

# Verify core user journeys work:
# - User registration/login
# - Journey creation
# - Location updates
# - Notifications
```

## 📋 Rollback Decision Matrix

| Severity | Error Rate | Response Time | User Impact | Action |
|----------|------------|---------------|-------------|---------|
| Critical | >10% | >10s | Cannot use app | **Immediate rollback** |
| High | 5-10% | 5-10s | Major features broken | **Fast rollback** |
| Medium | 1-5% | 2-5s | Minor issues | **Consider rollback** |
| Low | <1% | <2s | Cosmetic issues | **Monitor & fix forward** |

## 🔧 Environment-Specific Rollback

### Development Environment
```bash
# Development rollbacks are simpler
git reset --hard HEAD~1
docker-compose restart
```

### Staging Environment  
```bash
# Follow production procedure but with less urgency
# Use staging as test for production rollback
# Document any issues for production consideration
```

### Production Environment
```bash
# Follow full procedure with all verification steps
# Notify stakeholders immediately
# Document everything for post-mortem
```

## 📞 Communication During Rollback

### 1. Immediate Notification
```markdown
🚨 **EMERGENCY ROLLBACK IN PROGRESS**

**Issue**: Brief description
**Impact**: Production users affected
**ETA**: X minutes for rollback completion
**Status**: Rollback initiated at [TIME]

Updates will be provided every 5 minutes.
```

### 2. Progress Updates
```markdown
⏳ **ROLLBACK UPDATE - [TIME]**

**Status**: [In Progress/Testing/Complete]
**Actions Completed**:
- ✅ Rollback deployed to server
- ✅ Container restarted
- 🔄 Functional testing in progress

**Next Steps**: Complete verification in 3 minutes
```

### 3. Resolution Notification
```markdown
✅ **ROLLBACK COMPLETE - [TIME]**

**Status**: Service restored to previous stable state
**Verification**: All core functionality operational
**Impact**: Issue resolved, monitoring continues

**Next Steps**:
- Root cause analysis scheduled
- Fix development in progress
- Incident report to follow
```

## 📚 Documentation Requirements

### Incident Report Template
```markdown
# Incident Report: [DATE] - [BRIEF_DESCRIPTION]

## Summary
- **Date/Time**: 
- **Duration**: 
- **Impact**: 
- **Root Cause**: 

## Timeline
- [TIME]: Issue detected
- [TIME]: Rollback initiated  
- [TIME]: Service restored
- [TIME]: Verification complete

## Technical Details
- **Failing Component**: 
- **Error Messages**: 
- **Commits Reverted**: 
- **Data Impact**: 

## Lessons Learned
- **What Went Well**: 
- **What Could Improve**: 
- **Action Items**: 

## Prevention Measures
- **Testing Improvements**: 
- **Monitoring Enhancements**: 
- **Process Updates**: 
```

## 🔒 Security Considerations

### Access Control During Rollback
- Only authorized personnel can execute rollbacks
- All rollback actions must be logged
- Emergency access procedures documented
- Multi-person verification for critical rollbacks

### Data Protection
- Backup data before major rollbacks
- Verify no sensitive data exposed during rollback
- Monitor for security vulnerabilities in rollback state
- Document any temporary security configurations

---

## ⚡ Quick Reference Card

```bash
# EMERGENCY ROLLBACK - Copy/Paste Ready
ssh user@server
cd /app/tulink-backend
git log --oneline -5
git reset --hard PREVIOUS_COMMIT
docker restart CONTAINER_ID
curl https://api/health
docker logs CONTAINER_ID --tail=20
```

**Emergency Contacts**:
- Technical Lead: [Contact]
- DevOps Engineer: [Contact]  
- On-Call: [Contact]

---

*Print this reference and keep it accessible during emergencies.*