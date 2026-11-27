import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getApiUser } from "@/lib/session";

const createSubjectSchema = z.object({
  name: z.string().min(1, "Subject name is required").max(120),
  code: z.string().max(30).optional().nullable(),
  semester: z.string().max(30).optional().nullable(),
  color: z.string().default("#7C3AED"),
});

export async function GET() {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const subjects = await prisma.subject.findMany({
    where: { userId: user.id },
    include: {
      modules: {
        orderBy: { order: "asc" },
        include: {
          topics: {
            orderBy: { order: "asc" },
          },
        },
      },
      _count: {
        select: { notes: true, deadlines: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ subjects });
}

export async function POST(request: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = createSubjectSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid subject data" },
        { status: 400 },
      );
    }

    const d = parsed.data;
    const subject = await prisma.subject.create({
      data: {
        userId: user.id,
        name: d.name.trim(),
        code: d.code?.trim() || null,
        semester: d.semester?.trim() || null,
        color: d.color,
      },
      include: {
        modules: {
          include: { topics: true },
        },
        _count: { select: { notes: true, deadlines: true } },
      },
    });

    return NextResponse.json({ subject }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Failed to create subject" },
      { status: 500 },
    );
  }
}
