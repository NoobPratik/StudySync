import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiUser } from "@/lib/session";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const mod = await prisma.module.findFirst({
    where: { id, subject: { userId: user.id } },
  });

  if (!mod) {
    return NextResponse.json({ error: "Module not found" }, { status: 404 });
  }

  const body = await request.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const updated = await prisma.module.update({
    where: { id },
    data: { name },
  });

  return NextResponse.json({ module: updated });
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const mod = await prisma.module.findFirst({
    where: { id, subject: { userId: user.id } },
  });

  if (!mod) {
    return NextResponse.json({ error: "Module not found" }, { status: 404 });
  }

  await prisma.module.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
