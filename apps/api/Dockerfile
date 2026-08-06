# Build from the monorepo root so npm can use the shared workspace lockfile.
FROM node:20-alpine AS development
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN npm ci --workspace @tulink/api --ignore-scripts

COPY apps/api ./apps/api
WORKDIR /app/apps/api
ENV NODE_ENV=development
EXPOSE 3000

CMD ["npm", "run", "dev"]

FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN npm ci --workspace @tulink/api --ignore-scripts

COPY apps/api ./apps/api
WORKDIR /app/apps/api
RUN npm run build

FROM node:20-alpine AS production
RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001 -G nodejs
# curl is required by the compose-level healthcheck for the deployed api-dev
# service, which probes /health with `curl -f`. Without it the container never
# reports healthy and the deploy stalls on its health-wait loop.
RUN apk add --no-cache curl
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN npm ci --omit=dev --workspace @tulink/api --ignore-scripts && \
  npm cache clean --force

COPY --from=builder --chown=nestjs:nodejs /app/apps/api/dist ./apps/api/dist
RUN mkdir -p /app/apps/api/logs && chown nestjs:nodejs /app/apps/api/logs

WORKDIR /app/apps/api
EXPOSE 3000
USER nestjs

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "const http=require('http');http.get('http://localhost:3000/health',(res)=>{process.exit(res.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

CMD ["node", "dist/main.js"]
