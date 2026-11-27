import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getApiUser } from "@/lib/session";

const updateScratchSchema = z.object({
  title: z.string().min(1).max(160).optional(),
  content: z.string().max(15000).optional(),
  rawContent: z.string().max(15000).optional().nullable(),
  color: z.string().optional(),
  pinned: z.boolean().optional(),
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
  const existing = await prisma.scratchNote.findFirst({
    where: { id, userId: user.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = updateScratchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  }

  const d = parsed.data;
  const scratchNote = await prisma.scratchNote.update({
    where: { id },
    data: {
      ...(d.title !== undefined ? { title: d.title.trim() } : {}),
      ...(d.content !== undefined ? { content: d.content } : {}),
      ...(d.rawContent !== undefined ? { rawContent: d.rawContent } : {}),
      ...(d.color !== undefined ? { color: d.color } : {}),
      ...(d.pinned !== undefined ? { pinned: d.pinned } : {}),
    },
  });

  return NextResponse.json({ scratchNote });
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
  const existing = await prisma.scratchNote.findFirst({
    where: { id, userId: user.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.scratchNote.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
