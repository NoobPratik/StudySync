import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getApiUser } from "@/lib/session";

const updateDeadlineSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional().nullable(),
  questions: z.string().max(20000).optional().nullable(),
  deadlineType: z
    .enum([
      "ASSIGNMENT",
      "LAB_EXAM",
      "TEST",
      "MID_SEM",
      "END_SEM",
      "PROJECT",
      "OTHER",
    ])
    .optional(),
  dueAt: z.string().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED"]).optional(),
  subjectId: z.string().optional().nullable(),
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
  const existing = await prisma.deadline.findFirst({
    where: { id, userId: user.id },
  });

  if (!existing) {
    return NextResponse.json({ error: "Deadline not found" }, { status: 404 });
  }

  try {
    const body = await request.json();
    const parsed = updateDeadlineSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid data" },
        { status: 400 },
      );
    }

    const d = parsed.data;
    const deadline = await prisma.deadline.update({
      where: { id },
      data: {
        ...(d.title !== undefined ? { title: d.title.trim() } : {}),
        ...(d.description !== undefined
          ? { description: d.description?.trim() || null }
          : {}),
        ...(d.questions !== undefined
          ? { questions: d.questions?.trim() || null }
          : {}),
        ...(d.deadlineType !== undefined
          ? { deadlineType: d.deadlineType }
          : {}),
        ...(d.dueAt !== undefined ? { dueAt: new Date(d.dueAt) } : {}),
        ...(d.priority !== undefined ? { priority: d.priority } : {}),
        ...(d.status !== undefined ? { status: d.status } : {}),
        ...(d.subjectId !== undefined
          ? { subjectId: d.subjectId || null }
          : {}),
      },
      include: {
        subject: {
          select: { id: true, name: true, code: true, color: true },
        },
      },
    });

    return NextResponse.json({ deadline });
  } catch {
    return NextResponse.json(
      { error: "Failed to update deadline" },
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
  const existing = await prisma.deadline.findFirst({
    where: { id, userId: user.id },
  });

  if (!existing) {
    return NextResponse.json({ error: "Deadline not found" }, { status: 404 });
  }

  await prisma.deadline.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
