# Development stage
FROM node:20-alpine AS development
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine AS production
ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}
RUN addgroup -g 1001 -S nodejs
RUN adduser -S tulink -u 1001
WORKDIR /usr/src/app
COPY package*.json ./
# To handle native-compiled libraries
# RUN apk add --no-cache python3 make g++
# Set ownership of node_modules
# RUN mkdir -p /usr/src/app/node_modules && chown -R tulink:nodejs /usr/src/app/node_modules
# Switch to non-root user
# USER tulink
# Install only production dependencies
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
# Copy built application from development stage
COPY --chown=tulink:nodejs --from=development /usr/src/app/dist ./dist
# Expose port
EXPOSE 3000
# Run the application
CMD ["node", "dist/main"]
