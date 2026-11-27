# ─── StudySync Production Dockerfile (Next.js + PostgreSQL + Web Push PWA) ───

FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl && rm -rf /var/lib/apt/lists/*

# 1. Install all dependencies for building
FROM base AS deps
COPY package.json package-lock.json .npmrc* ./
RUN npm ci

# 2. Build standalone app configured for PostgreSQL
FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_STANDALONE=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Switch Prisma datasource provider from local sqlite to PostgreSQL for container deployment
RUN sed -i 's/provider = "sqlite"/provider = "postgresql"/' prisma/schema.prisma
ENV DATABASE_URL="postgresql://studysync:studysync@localhost:5432/studysync"
ENV BETTER_AUTH_SECRET="build-time-placeholder-secret-replace-at-runtime"
ENV BETTER_AUTH_URL="http://localhost:3000"

RUN node node_modules/prisma/build/index.js generate
# .npmrc sets bin-links=false, so there is no node_modules/.bin/next shim.
# Invoke the Next.js CLI entrypoint directly, like the Prisma command above.
RUN node node_modules/next/dist/bin/next build --webpack

# Next's output tracing keeps the libsql JS wrapper but omits its platform-native
# package. The Prisma adapter imports it eagerly even when running on PostgreSQL,
# so copy the installed @libsql packages into the standalone output.
RUN mkdir -p .next/standalone/node_modules/@libsql \
  && cp -a node_modules/@libsql/. .next/standalone/node_modules/@libsql/

# Separate lightweight directory containing Prisma CLI + dotenv for entrypoint schema sync
RUN mkdir -p /prisma-cli && cd /prisma-cli \
  && npm init -y >/dev/null 2>&1 \
  && npm install --omit=dev prisma@7.10.1 dotenv@18.0.10 pg@8.16.0

# 3. Minimal production runner
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /prisma-cli/node_modules ./prisma-cli/node_modules
COPY docker/entrypoint.sh /app/entrypoint.sh

RUN chmod +x /app/entrypoint.sh && mkdir -p /app/uploads

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

CMD ["/app/entrypoint.sh"]
