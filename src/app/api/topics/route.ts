import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getApiUser } from "@/lib/session";

const createTopicSchema = z.object({
  moduleId: z.string().min(1),
  name: z.string().min(1, "Topic name is required").max(200),
});

export async function POST(request: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = createTopicSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid topic data" },
        { status: 400 },
      );
    }

    const mod = await prisma.module.findFirst({
      where: { id: parsed.data.moduleId, subject: { userId: user.id } },
      include: { _count: { select: { topics: true } } },
    });

    if (!mod) {
      return NextResponse.json({ error: "Module not found" }, { status: 404 });
    }

    const topic = await prisma.topic.create({
      data: {
        moduleId: mod.id,
        name: parsed.data.name.trim(),
        order: mod._count.topics,
      },
    });

    return NextResponse.json({ topic }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Failed to create topic" },
      { status: 500 },
    );
  }
}
