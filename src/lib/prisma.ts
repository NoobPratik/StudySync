import { PrismaClient } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  pgPool: Pool | undefined;
};

function createPrismaClient() {
  const url = process.env.DATABASE_URL || "file:./dev.db";
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    const pool = globalForPrisma.pgPool ?? new Pool({ connectionString: url });
    if (process.env.NODE_ENV !== "production") {
      globalForPrisma.pgPool = pool;
    }
    const adapter = new PrismaPg(pool);
    return new PrismaClient({ adapter });
  }
  const adapter = new PrismaLibSql({ url });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
