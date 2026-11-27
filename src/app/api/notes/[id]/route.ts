import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getApiUser } from "@/lib/session";

const UPLOAD_ROOT = path.resolve(process.cwd(), process.env.UPLOAD_DIR || "./uploads");

const updateNoteSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  subjectId: z.string().nullable().optional(),
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
  const existing = await prisma.note.findFirst({
    where: { id, userId: user.id },
  });

  if (!existing) {
    return NextResponse.json({ error: "Note not found" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = updateNoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid data" },
      { status: 400 },
    );
  }

  const note = await prisma.note.update({
    where: { id },
    data: {
      ...(parsed.data.title !== undefined
        ? { title: parsed.data.title.trim() }
        : {}),
      ...(parsed.data.subjectId !== undefined
        ? { subjectId: parsed.data.subjectId || null }
        : {}),
    },
    include: {
      subject: {
        select: { id: true, name: true, code: true, color: true },
      },
    },
  });

  return NextResponse.json({ note });
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
  const existing = await prisma.note.findFirst({
    where: { id, userId: user.id },
  });

  if (!existing) {
    return NextResponse.json({ error: "Note not found" }, { status: 404 });
  }

  const fullPath = path.resolve(UPLOAD_ROOT, existing.filePath);
  if (fullPath.startsWith(UPLOAD_ROOT)) {
    await fs.unlink(fullPath).catch(() => {});
  }

  await prisma.note.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
