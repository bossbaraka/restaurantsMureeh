import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';

dotenv.config();

declare global {
  var prisma: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  const url = process.env.DATABASE_URL;

  if (!url) {
    // No DATABASE_URL (dev/test without a database): fall back to the default
    // client. It will fail on first query, which is the expected fail-closed
    // behaviour when a database is not configured.
    return new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }

  // Prisma 6 client engine (WASM, bundled with @prisma/client) + the official
  // pg driver adapter. No native Prisma engine binary is downloaded or loaded,
  // which keeps `npm install` working even on networks where binaries.prisma.sh
  // is unreachable, and removes a moving part from deploys.
  const adapter = new PrismaPg({ connectionString: url });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

export const prisma = global.prisma || createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}
