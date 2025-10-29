# Multi-stage build for faker-mcp-server-docker
# Stage 1: Build stage
FROM node:23-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for building)
RUN npm ci

# Copy source code
COPY . .

# Build the TypeScript code
RUN npm run build

# Stage 2: Production stage
FROM node:23-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies (skip prepare script since we copy built files)
RUN npm ci --omit=dev --ignore-scripts

# Copy built files from builder stage
COPY --from=builder /app/build ./build

# Expose port (Render will set PORT env variable)
EXPOSE 3000

# Set environment to production
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 3000) + '/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) })"

# Start the HTTP server
CMD ["node", "build/http-index.js"]
