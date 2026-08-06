FROM node:20-alpine AS development
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN npm ci --workspace @tulink/dashboard --ignore-scripts

COPY apps/dashboard ./apps/dashboard
COPY packages/ui ./packages/ui
WORKDIR /app/apps/dashboard
ENV NODE_ENV=development
ENV HOSTNAME=0.0.0.0
EXPOSE 3001

CMD ["npm", "run", "dev"]

FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN npm ci --workspace @tulink/dashboard --ignore-scripts

COPY apps/dashboard ./apps/dashboard
COPY packages/ui ./packages/ui

ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
ENV NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=${NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN}

WORKDIR /app/apps/dashboard
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001 -G nodejs

COPY --from=builder --chown=nextjs:nodejs /app/apps/dashboard/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/dashboard/.next/static ./apps/dashboard/.next/static

USER nextjs
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "const http=require('http');http.get('http://localhost:3001/',(res)=>{process.exit(res.statusCode>=200&&res.statusCode<400?0:1)}).on('error',()=>process.exit(1))"

CMD ["node", "apps/dashboard/server.js"]
