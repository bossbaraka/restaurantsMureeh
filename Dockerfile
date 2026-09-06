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

CMD ["sh", "-c", "npx prisma db push --accept-data-loss && npx tsx server/index.ts"]
