# Stage 1: Build the React application
FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY client/package.json ./client/package.json
RUN npm ci --workspace=client --include-workspace-root=false

COPY client/ ./client/
COPY shared/ ./shared/

# Build for production
RUN npm run build --workspace=client

# Stage 2: Serve with Nginx
FROM nginxinc/nginx-unprivileged:stable-alpine

# Copy built assets
COPY --from=build /app/client/dist /usr/share/nginx/html

# Copy custom nginx config
COPY client/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
