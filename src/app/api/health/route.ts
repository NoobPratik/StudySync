import { NextResponse } from "next/server";
import { connection } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  await connection();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, status: "healthy" });
  } catch {
    return NextResponse.json(
      { ok: false, status: "unhealthy" },
      { status: 500 },
    );
  }
}
