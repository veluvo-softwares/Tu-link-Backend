# Deployment Checklist

A comprehensive checklist to ensure all deployment steps are completed correctly and safely.

## 🎯 Pre-Deployment

### Code Preparation
- [ ] All code changes tested locally
- [ ] TypeScript compilation passes (`npm run typecheck`)
- [ ] Linting passes (`npm run lint`)
- [ ] Tests pass (`npm test`)
- [ ] No console.log statements in production code
- [ ] Environment variables documented
- [ ] Breaking changes documented

### Git Workflow
- [ ] Working directory is clean (no uncommitted changes)
- [ ] Current branch is up to date with main
- [ ] Feature branch created with descriptive name
- [ ] Commit message follows conventional commits
- [ ] All files staged and committed

## 🚀 Deployment Process

### Local Git Operations
- [ ] Changes stashed successfully
- [ ] Feature branch created and checked out
- [ ] Stashed changes applied to feature branch
- [ ] All changes staged (`git add .`)
- [ ] Commit created with proper message format
- [ ] Branch pushed to remote repository

### Pull Request Process
- [ ] PR created with comprehensive description
- [ ] PR title follows naming conventions
- [ ] All required fields completed (Summary, Features, Testing)
- [ ] Breaking changes section filled if applicable
- [ ] PR merged successfully (squash merge preferred)
- [ ] Feature branch deleted after merge
- [ ] Local main branch updated with latest changes

### Server Deployment
- [ ] SSH connection established successfully
- [ ] Navigated to correct application directory
- [ ] Git fetch completed without errors
- [ ] Git pull/rebase completed successfully
- [ ] No merge conflicts encountered
- [ ] Container/service restarted
- [ ] Container restart completed without errors

## ✅ Post-Deployment Verification

### Application Health
- [ ] Container is running (`docker ps`)
- [ ] Application startup logs show no errors
- [ ] All required services connected (Redis, Firebase, etc.)
- [ ] API routes properly registered
- [ ] Health endpoint responding (`/health`)
- [ ] No memory or CPU spikes

### Functional Testing
- [ ] Authentication endpoints working
- [ ] Critical API endpoints responding
- [ ] Database connections active
- [ ] External service integrations working
- [ ] WebSocket connections (if applicable)
- [ ] File uploads/downloads (if applicable)

### Performance Checks
- [ ] Response times within acceptable range
- [ ] Error rates remain low
- [ ] Resource utilization normal
- [ ] No unusual log patterns
- [ ] Cache systems functioning

## 🔍 Monitoring (First 30 minutes)

### Immediate Checks (0-5 minutes)
- [ ] Application started successfully
- [ ] No critical errors in logs
- [ ] Basic functionality verified
- [ ] User authentication working

### Short-term Monitoring (5-30 minutes)
- [ ] Error rate monitoring
- [ ] Response time monitoring
- [ ] User activity patterns normal
- [ ] System resource usage stable
- [ ] No customer complaints received

## 🚨 Rollback Criteria

Rollback immediately if any of these occur:
- [ ] Critical functionality broken
- [ ] Error rate > 5%
- [ ] Response time > 5 seconds
- [ ] Database corruption detected
- [ ] Security vulnerability exposed
- [ ] Complete service outage

## 📋 Documentation Updates

### Post-Deployment Tasks
- [ ] Update changelog if applicable
- [ ] Update API documentation if endpoints changed
- [ ] Update environment variable documentation
- [ ] Notify team of deployment completion
- [ ] Update deployment logs/records

### Communication
- [ ] Stakeholders notified of deployment
- [ ] Team updated on changes
- [ ] Customer-facing changes communicated
- [ ] Support team briefed on new features

## 📊 Deployment Record

Fill this out for each deployment:

```
Deployment Date: ___________
Deployed By: ___________
Git Commit Hash: ___________
Branch Name: ___________
PR Number: ___________
Container ID: ___________
Deployment Time: ___ minutes
Issues Encountered: ___________
Rollback Required: Yes/No
Notes: ___________
```

## 🔧 Environment-Specific Checks

### Development Server
- [ ] Test data properly seeded
- [ ] Debug modes enabled appropriately
- [ ] Development-specific configurations active

### Staging Server
- [ ] Production-like data available
- [ ] All integration tests passing
- [ ] Performance benchmarks met
- [ ] Security scans completed

### Production Server
- [ ] All monitoring systems active
- [ ] Backup systems verified
- [ ] Security hardening in place
- [ ] Performance optimization enabled
- [ ] Error tracking configured

## 🔍 Log Analysis Checklist

### Startup Logs
- [ ] Application version logged correctly
- [ ] Environment variables loaded properly
- [ ] Database connections established
- [ ] External services connected
- [ ] Routes mapped successfully

### Runtime Logs
- [ ] No error spikes after deployment
- [ ] Performance metrics stable
- [ ] User activity patterns normal
- [ ] Background jobs processing correctly

## 📞 Emergency Contacts

In case of deployment issues:

1. **Technical Lead**: [Contact method]
2. **DevOps Engineer**: [Contact method]
3. **On-Call Engineer**: [Contact method]
4. **Product Owner**: [Contact method]

## 📚 Quick Reference Links

- [Rollback Procedure](./rollback-procedure.md)
- [Troubleshooting Guide](../troubleshooting/common-issues.md)
- [Environment Configuration](../development/environment-setup.md)
- [Monitoring Dashboard](https://your-monitoring-url)

---

## ⚡ Quick Deployment Verification Script

```bash
#!/bin/bash
# deployment-verify.sh

echo "🔍 Starting deployment verification..."

# Check container status
CONTAINER_STATUS=$(docker ps --format "table {{.Names}}\t{{.Status}}" | grep tulink)
echo "📦 Container Status: $CONTAINER_STATUS"

# Check health endpoint
HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://your-api-domain/health)
echo "🏥 Health Check: HTTP $HEALTH_STATUS"

# Check authentication
AUTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST https://your-api-domain/auth/login -H "Content-Type: application/json" -d '{"email":"test","password":"test"}')
echo "🔐 Auth Check: HTTP $AUTH_STATUS"

# Check recent logs for errors
ERROR_COUNT=$(docker logs CONTAINER_ID --since="5m" 2>&1 | grep -i "error" | wc -l)
echo "⚠️  Recent Errors: $ERROR_COUNT"

if [[ $HEALTH_STATUS -eq 200 && $AUTH_STATUS -eq 401 && $ERROR_COUNT -eq 0 ]]; then
    echo "✅ Deployment verification PASSED"
else
    echo "❌ Deployment verification FAILED - investigate immediately"
fi
```

---

*Use this checklist for every deployment to ensure consistency and reliability.*