# Build Stage for Frontend
FROM node:22-alpine AS frontend-builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma/
RUN npx prisma generate
COPY . .
RUN npm run build

# Production Runner
FROM node:22-alpine AS runner
WORKDIR /app

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl

COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --omit=dev && npx prisma generate

COPY --from=frontend-builder /app/dist ./dist
COPY --from=frontend-builder /app/server ./server
COPY --from=frontend-builder /app/node_modules ./node_modules

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001


CMD ["npx", "tsx", "server/index.ts"]