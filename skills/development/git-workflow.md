# Git Workflow for TuLink Backend

Standardized Git workflow and best practices for the TuLink Backend development team.

## 🌟 Overview

Our Git workflow emphasizes safety, traceability, and collaboration while maintaining clean commit history.

## 🔄 Branching Strategy

### Branch Types
- **`main`** - Production-ready code
- **`feature/*`** - New features or enhancements  
- **`fix/*`** - Bug fixes
- **`hotfix/*`** - Critical production fixes
- **`refactor/*`** - Code improvements without behavior change

### Branch Naming Convention
```bash
feature/implement-rtdb-integration
fix/authentication-token-expiration
hotfix/critical-memory-leak
refactor/optimize-location-service
```

## 📝 Commit Message Standards

### Conventional Commits Format
```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### Commit Types
- **feat**: New features
- **fix**: Bug fixes
- **docs**: Documentation changes
- **style**: Code formatting, no logic change
- **refactor**: Code restructuring, no behavior change
- **test**: Adding or updating tests
- **chore**: Maintenance tasks, build updates

### Examples
```bash
# Good commit messages
feat: implement Firebase RTDB integration for real-time location tracking
fix: resolve authentication token expiration handling
docs: update API documentation for location endpoints
refactor: optimize database queries in journey service

# Bad commit messages
fix bug
update code
changes
wip
```

## 🔧 Development Workflow

### 1. Start New Work
```bash
# Ensure you're on main with latest changes
git checkout main
git pull origin main

# Create feature branch
git checkout -b feature/your-feature-name

# Verify branch creation
git branch --show-current
```

### 2. Development Process
```bash
# Make changes and test locally
npm run lint
npm run typecheck
npm test

# Stage changes
git add .

# Commit with descriptive message
git commit -m "feat: add real-time location sync functionality

- Implement Firebase RTDB integration
- Add fallback to Redis cache
- Update location interfaces
- Add comprehensive error handling"
```

### 3. Push and Create PR
```bash
# Push feature branch
git push -u origin feature/your-feature-name

# Create pull request
gh pr create --title "🚀 Implement Real-time Location Sync" --body "
## Summary
This PR implements real-time location synchronization using Firebase RTDB.

## Changes
- Added RTDB integration service
- Updated location endpoints
- Enhanced error handling
- Updated TypeScript interfaces

## Testing
- ✅ All unit tests pass
- ✅ Integration tests updated
- ✅ Manual testing completed
"
```

### 4. Code Review Process
```bash
# Address review feedback
git add .
git commit -m "fix: address code review feedback

- Update error handling logic
- Add missing type annotations
- Fix linting issues"

# Push updates
git push origin feature/your-feature-name
```

### 5. Merge and Cleanup
```bash
# Merge via GitHub (squash merge preferred)
gh pr merge --squash --delete-branch

# Update local main branch
git checkout main
git pull origin main

# Delete local feature branch
git branch -d feature/your-feature-name
```

## 🚀 Pre-commit Hooks

Our repository includes automated checks:

### Husky Configuration
```json
{
  "husky": {
    "hooks": {
      "pre-commit": "lint-staged",
      "commit-msg": "commitlint -E HUSKY_GIT_PARAMS"
    }
  }
}
```

### Lint Staged Tasks
```javascript
module.exports = {
  '*.{ts,js}': [
    'eslint --fix',
    'prettier --write'
  ],
  '*.{md,json}': [
    'prettier --write'
  ]
};
```

## 🔒 Protected Branch Rules

### Main Branch Protection
- ✅ Require pull request reviews
- ✅ Require status checks to pass
- ✅ Require branches to be up to date
- ✅ Include administrators
- ❌ Allow force pushes
- ❌ Allow deletions

### Required Status Checks
- TypeScript compilation
- ESLint validation
- Unit tests
- Integration tests
- Security scan

## 🔧 Git Configuration

### Recommended Global Config
```bash
# User information
git config --global user.name "Your Name"
git config --global user.email "your.email@company.com"

# Default branch
git config --global init.defaultBranch main

# Pull strategy
git config --global pull.rebase false

# Auto-setup remote tracking
git config --global push.autoSetupRemote true

# Better log format
git config --global alias.lg "log --color --graph --pretty=format:'%Cred%h%Creset -%C(yellow)%d%Creset %s %Cgreen(%cr) %C(bold blue)<%an>%Creset' --abbrev-commit"
```

## 🔍 Useful Git Commands

### Daily Workflow
```bash
# Check status
git status --short

# View changes before staging
git diff

# View staged changes
git diff --cached

# Interactive staging
git add -p

# Commit with editor for detailed message
git commit

# Push with tracking
git push -u origin branch-name
```

### History and Information
```bash
# Compact log view
git log --oneline -10

# Graph view of branches
git log --graph --oneline --all

# See what changed in last commit
git show

# Find commits by message
git log --grep="keyword"

# See commits by author
git log --author="username"
```

### Branch Management
```bash
# List all branches
git branch -a

# Delete merged branches
git branch --merged | grep -v main | xargs git branch -d

# Track remote branch
git checkout --track origin/branch-name

# Rename current branch
git branch -m new-name
```

### Undoing Changes
```bash
# Undo last commit (keep changes staged)
git reset --soft HEAD~1

# Undo last commit (unstage changes)
git reset HEAD~1

# Discard local changes
git checkout -- file.txt

# Discard all local changes
git reset --hard HEAD
```

## 🚨 Emergency Procedures

### Hotfix Workflow
```bash
# Create hotfix from main
git checkout main
git pull origin main
git checkout -b hotfix/critical-issue

# Make minimal fix
# Test thoroughly
git add .
git commit -m "hotfix: resolve critical security vulnerability"

# Push and create urgent PR
git push -u origin hotfix/critical-issue
gh pr create --title "🔥 HOTFIX: Critical Security Issue"

# Fast-track review and merge
gh pr merge --admin --squash --delete-branch
```

### Recovery from Force Push
```bash
# Find lost commits
git reflog

# Recover specific commit
git checkout COMMIT_HASH
git checkout -b recovery-branch

# Merge back to main if needed
git checkout main
git merge recovery-branch
```

## 📊 Release Management

### Tagging Releases
```bash
# Create annotated tag
git tag -a v1.2.0 -m "Release version 1.2.0

- Add real-time location tracking
- Improve authentication flow
- Bug fixes and performance improvements"

# Push tags
git push origin --tags

# List recent tags
git tag --sort=-version:refname | head -5
```

### Release Notes
```bash
# Generate changelog between tags
git log v1.1.0..v1.2.0 --oneline --no-merges

# Detailed changes
git log v1.1.0..v1.2.0 --pretty=format:"- %s (%h)" --no-merges
```

## 🔗 Integration with GitHub

### GitHub CLI Usage
```bash
# View repository status
gh repo view

# List and manage PRs
gh pr list
gh pr view 123
gh pr checkout 123

# Manage issues
gh issue list
gh issue create --title "Bug: Authentication fails"

# View GitHub Actions status
gh run list
gh run view RUN_ID
```

## 📚 Best Practices

### Do's ✅
- Write descriptive commit messages
- Test before committing
- Use feature branches for all changes
- Rebase feature branches before merging
- Squash commits when merging
- Review code before approving
- Keep branches focused and small

### Don'ts ❌
- Commit directly to main
- Force push to shared branches
- Commit sensitive information
- Use generic commit messages
- Leave broken code in commits
- Mix unrelated changes in one commit
- Ignore pre-commit hook failures

---

## 📞 Support and Resources

- **Git Documentation**: [git-scm.com](https://git-scm.com/doc)
- **GitHub CLI**: [cli.github.com](https://cli.github.com/)
- **Conventional Commits**: [conventionalcommits.org](https://www.conventionalcommits.org/)
- **Team Standards**: See `../CONTRIBUTING.md`

---

*This workflow ensures code quality, maintainability, and team collaboration efficiency.*