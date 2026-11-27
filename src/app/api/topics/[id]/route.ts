import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getApiUser } from "@/lib/session";

const updateTopicSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  isCompleted: z.boolean().optional(),
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
  const topic = await prisma.topic.findFirst({
    where: { id, module: { subject: { userId: user.id } } },
  });

  if (!topic) {
    return NextResponse.json({ error: "Topic not found" }, { status: 404 });
  }

  try {
    const body = await request.json();
    const parsed = updateTopicSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid data" },
        { status: 400 },
      );
    }

    const d = parsed.data;
    const updated = await prisma.topic.update({
      where: { id },
      data: {
        ...(d.name !== undefined ? { name: d.name.trim() } : {}),
        ...(d.isCompleted !== undefined
          ? {
              isCompleted: d.isCompleted,
              completedAt: d.isCompleted ? new Date() : null,
            }
          : {}),
      },
    });

    return NextResponse.json({ topic: updated });
  } catch {
    return NextResponse.json(
      { error: "Failed to update topic" },
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
  const topic = await prisma.topic.findFirst({
    where: { id, module: { subject: { userId: user.id } } },
  });

  if (!topic) {
    return NextResponse.json({ error: "Topic not found" }, { status: 404 });
  }

  await prisma.topic.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
