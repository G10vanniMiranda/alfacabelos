# syntax=docker/dockerfile:1.7
# Production image for the VPS deployment (deploy/vps). No secret is read at build time:
# every runtime variable comes from the env file mounted by Docker Compose.
ARG NODE_IMAGE=node:24.11.1-bookworm-slim@sha256:48abc13a19400ca3985071e287bd405a1d99306770eb81d61202fb6b65cf0b57

FROM ${NODE_IMAGE} AS base
# Prisma's query engine needs OpenSSL; ca-certificates for TLS to Supabase and the WhatsApp provider.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build-time placeholders only: Prisma needs a syntactically valid URL to generate the client.
# Pages that read the database are dynamic, so nothing connects during the build.
RUN DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build" \
    DIRECT_URL="postgresql://build:build@127.0.0.1:5432/build" \
    npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/scripts/notification-scheduler.mjs ./scripts/notification-scheduler.mjs
USER node
EXPOSE 3000
# Liveness only (no database call), so a database outage does not take the container out of routing.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/robots.txt').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]
