# Multi-stage build for production optimization
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (skip prepare scripts to avoid husky in Docker)
RUN npm ci --only=production --ignore-scripts && npm cache clean --force

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine AS production

# Create app user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nestjs -u 1001

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies (skip prepare scripts to avoid husky in Docker)
RUN npm ci --only=production --ignore-scripts --silent && npm cache clean --force

# Copy built application from builder stage
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules

# Create logs directory
RUN mkdir -p logs && chown nestjs:nodejs logs

# Expose port
EXPOSE 3000

# Switch to non-root user
USER nestjs

# Add health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "const http=require('http');http.get('http://localhost:3000/health',(res)=>{process.exit(res.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

# Start the application
CMD ["node", "dist/main.js"]