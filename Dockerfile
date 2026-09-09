# Build Stage for Frontend
FROM node:22-alpine AS frontend-builder
WORKDIR /app

# Copy the Prisma schema BEFORE npm ci: the "postinstall" script runs
# "prisma generate", which fails if prisma/schema.prisma is not present yet.
COPY prisma ./prisma/
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production Runner
FROM node:22-alpine AS runner
WORKDIR /app

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl

# Same order here: schema first, then install (postinstall -> prisma generate)
COPY prisma ./prisma/
COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=frontend-builder /app/dist ./dist
COPY --from=frontend-builder /app/server ./server
COPY --from=frontend-builder /app/node_modules ./node_modules

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001

# Production boot: apply committed migrations, then start.
#
# NEVER `db push --accept-data-loss` (destroys schema drift silently) and
# NEVER `db:seed` at boot — seeding on every restart reverted operator
# password rotations and rewrote the plan catalogue (audit C-02 / C-03).
# `migrate deploy` is additive and refuses to apply anything not committed
# as a migration. Seeding is a deliberate one-time operator action:
#   docker compose exec app npm run db:seed
CMD ["sh", "-c", "npx tsx server/db/deploy-migrations.ts && npx tsx server/index.ts"]
