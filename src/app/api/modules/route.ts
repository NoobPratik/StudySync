import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getApiUser } from "@/lib/session";

const createModuleSchema = z.object({
  subjectId: z.string().min(1),
  name: z.string().min(1, "Module name is required").max(200),
});

export async function POST(request: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = createModuleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid module data" },
        { status: 400 },
      );
    }

    const subject = await prisma.subject.findFirst({
      where: { id: parsed.data.subjectId, userId: user.id },
      include: { _count: { select: { modules: true } } },
    });

    if (!subject) {
      return NextResponse.json({ error: "Subject not found" }, { status: 404 });
    }

    const mod = await prisma.module.create({
      data: {
        subjectId: subject.id,
        name: parsed.data.name.trim(),
        order: subject._count.modules,
      },
      include: { topics: true },
    });

    return NextResponse.json({ module: mod }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Failed to create module" },
      { status: 500 },
    );
  }
}
