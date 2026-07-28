# Development stage
FROM node:20-alpine AS development
WORKDIR /usr/src/app

# Install curl for health checks
RUN apk add --no-cache curl

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN npm ci --workspace @tulink/api --ignore-scripts
COPY apps/api ./apps/api

WORKDIR /usr/src/app/apps/api
RUN npm run build

CMD ["npm", "run", "start:dev"]

# Production stage
FROM node:20-alpine AS production
ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S tulink -u 1001 -G nodejs

WORKDIR /usr/src/app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN npm ci --omit=dev --workspace @tulink/api --ignore-scripts && \
    npm cache clean --force

COPY --chown=tulink:nodejs --from=development /usr/src/app/apps/api/dist ./apps/api/dist

RUN mkdir -p /usr/src/app/apps/api/logs && \
    chown -R tulink:nodejs /usr/src/app/apps/api/logs

WORKDIR /usr/src/app/apps/api
USER tulink

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "const http = require('http'); \
        const req = http.request({hostname: 'localhost', port: 3000, path: '/health', method: 'GET'}, (res) => { \
            process.exit(res.statusCode === 200 ? 0 : 1); \
        }); \
        req.on('error', () => process.exit(1)); \
        req.end();"

EXPOSE 3000

CMD ["node", "dist/main"]
