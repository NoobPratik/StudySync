import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getApiUser } from "@/lib/session";

const updateSubjectSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  code: z.string().max(30).optional().nullable(),
  semester: z.string().max(30).optional().nullable(),
  color: z.string().optional(),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const existing = await prisma.subject.findFirst({
    where: { id, userId: user.id },
  });

  if (!existing) {
    return NextResponse.json({ error: "Subject not found" }, { status: 404 });
  }

  try {
    const body = await request.json();
    const parsed = updateSubjectSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid data" },
        { status: 400 },
      );
    }

    const d = parsed.data;
    const subject = await prisma.subject.update({
      where: { id },
      data: {
        ...(d.name !== undefined ? { name: d.name.trim() } : {}),
        ...(d.code !== undefined ? { code: d.code?.trim() || null } : {}),
        ...(d.semester !== undefined
          ? { semester: d.semester?.trim() || null }
          : {}),
        ...(d.color !== undefined ? { color: d.color } : {}),
      },
    });

    return NextResponse.json({ subject });
  } catch {
    return NextResponse.json(
      { error: "Failed to update subject" },
      { status: 500 },
    );
  }
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
  const existing = await prisma.subject.findFirst({
    where: { id, userId: user.id },
  });

  if (!existing) {
    return NextResponse.json({ error: "Subject not found" }, { status: 404 });
  }

  await prisma.subject.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
