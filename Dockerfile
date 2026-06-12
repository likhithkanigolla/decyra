# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies using npm
COPY package.json package-lock.json ./
RUN npm ci

# Copy application source
COPY . .

# Build application (generates .output for node-server preset)
RUN npm run build

# Bundle the create-admin script so it can run in production without TypeScript
RUN npx esbuild scripts/create-admin.ts --bundle --platform=node --format=esm --outfile=.output/create-admin.mjs

# Production stage
FROM node:22-alpine AS runner

WORKDIR /app

# Copy built assets
COPY --from=builder /app/.output ./.output
COPY --from=builder /app/package.json ./

# Set environment variables
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

# Expose the application port
EXPOSE 3000

# Start the application (run admin creation first, then start server)
CMD ["sh", "-c", "node .output/create-admin.mjs && node .output/server/index.mjs"]
