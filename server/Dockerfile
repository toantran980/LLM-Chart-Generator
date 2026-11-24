# Stage 1: Build the TypeScript application
FROM node:24-alpine AS build

WORKDIR /app

# Install the server workspace from the repository lockfile.
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY client/package.json ./client/package.json
RUN npm ci --workspace=server --include-workspace-root=false

# Copy backend source, tsconfig, and shared types
COPY server/tsconfig.json ./server/
COPY server/src/ ./server/src/
COPY shared/ ./shared/

# Build the TypeScript project
RUN npm run build --workspace=server

# Stage 2: Production image
FROM node:24-alpine

WORKDIR /app

# Keep the container's default port aligned with its published port.
ENV PORT=4000

# Install only backend production dependencies from the same lockfile.
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY client/package.json ./client/package.json
RUN npm ci --omit=dev --workspace=server --include-workspace-root=false

# Copy compiled JS code from the build stage (preserves dist/server/src/ and dist/shared/ structure)
COPY --from=build /app/server/dist ./dist

# Switch to the built-in non-root 'node' user for security
USER node

# Expose the port the app runs on
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/ready').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Run the compiled application from the real output path
CMD ["node", "dist/server/src/index.js"]
