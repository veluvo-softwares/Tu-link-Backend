# Development stage
FROM node:20-alpine AS development
WORKDIR /usr/src/app

# Install curl for health checks
RUN apk add --no-cache curl

COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .

# Build the application for both development and production
# NestJS requires the build even for development mode with --watch
RUN npm run build

# Development CMD (will be overridden by docker-compose)
CMD ["npm", "run", "start:dev"]

# Production stage
FROM node:20-alpine AS production
ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S tulink -u 1001 -G nodejs

WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm ci --omit=dev --ignore-scripts && \
    npm cache clean --force

# Copy built application from development stage
COPY --chown=tulink:nodejs --from=development /usr/src/app/dist ./dist

# Create logs directory
RUN mkdir -p logs && chown -R tulink:nodejs logs

# Switch to non-root user
USER tulink

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "const http = require('http'); \
        const req = http.request({hostname: 'localhost', port: 3000, path: '/health', method: 'GET'}, (res) => { \
            process.exit(res.statusCode === 200 ? 0 : 1); \
        }); \
        req.on('error', () => process.exit(1)); \
        req.end();"

# Expose port
EXPOSE 3000

# Run the application
CMD ["node", "dist/main"]
