# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies using npm
COPY package.json package-lock.json ./
RUN npm install

# Copy application source
COPY . .

# Force production environment for the Vite/React compiler
ENV NODE_ENV=production
ENV VITE_DATABASE_TYPE=postgres

# Build application (generates .output for node-server preset)
RUN npm run build

# Compile the create-admin script (without bundling external node_modules)
RUN npx esbuild scripts/create-admin.ts --bundle --platform=node --format=esm --packages=external --outfile=.output/create-admin.mjs

# Production stage
FROM node:22-alpine AS runner

WORKDIR /app

# Install ONLY production dependencies for a lightweight image
COPY package.json package-lock.json ./
RUN npm install --omit=dev

# Copy built assets and necessary runtime files
COPY --from=builder /app/.output ./.output
COPY --from=builder /app/supabase ./supabase

# Set environment variables
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

# Expose the application port
EXPOSE 3000

# Start the application (run admin creation first, then start server)
CMD ["sh", "-c", "node .output/create-admin.mjs && node .output/server/index.mjs"]
