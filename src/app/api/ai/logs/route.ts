import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiUser } from "@/lib/session";

export async function GET() {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const logs = await prisma.aiLog.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 40,
  });

  return NextResponse.json({ logs });
}

export async function DELETE() {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prisma.aiLog.deleteMany({ where: { userId: user.id } });
  return NextResponse.json({ success: true });
}
