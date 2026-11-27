import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getApiUser } from "@/lib/session";

const createDeadlineSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
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
    .default("ASSIGNMENT"),
  dueAt: z.string().min(1, "Due date is required"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED"]).default("PENDING"),
  subjectId: z.string().optional().nullable(),
});

export async function GET(request: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const type = searchParams.get("type");
  const subjectId = searchParams.get("subjectId");

  const deadlines = await prisma.deadline.findMany({
    where: {
      userId: user.id,
      ...(status && status !== "ALL" ? { status } : {}),
      ...(type && type !== "ALL" ? { deadlineType: type } : {}),
      ...(subjectId && subjectId !== "ALL" ? { subjectId } : {}),
    },
    include: {
      subject: {
        select: { id: true, name: true, code: true, color: true },
      },
    },
    orderBy: [{ status: "asc" }, { dueAt: "asc" }],
  });

  return NextResponse.json({ deadlines });
}

export async function POST(request: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = createDeadlineSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid deadline data" },
        { status: 400 },
      );
    }

    const d = parsed.data;
    const dueAt = new Date(d.dueAt);
    if (isNaN(dueAt.getTime())) {
      return NextResponse.json({ error: "Invalid due date" }, { status: 400 });
    }

    if (d.subjectId) {
      const subject = await prisma.subject.findFirst({
        where: { id: d.subjectId, userId: user.id },
      });
      if (!subject) {
        return NextResponse.json(
          { error: "Subject not found" },
          { status: 404 },
        );
      }
    }

    const deadline = await prisma.deadline.create({
      data: {
        userId: user.id,
        title: d.title.trim(),
        description: d.description?.trim() || null,
        questions: d.questions?.trim() || null,
        deadlineType: d.deadlineType,
        dueAt,
        priority: d.priority,
        status: d.status,
        subjectId: d.subjectId || null,
      },
      include: {
        subject: {
          select: { id: true, name: true, code: true, color: true },
        },
      },
    });

    return NextResponse.json({ deadline }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Failed to create deadline" },
      { status: 500 },
    );
  }
}
