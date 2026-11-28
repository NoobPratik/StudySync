import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getApiUser } from "@/lib/session";

const reorderSchema = z.object({
  moduleId: z.string().min(1),
  topicIds: z.array(z.string().min(1)).min(1),
});

export async function PATCH(request: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = reorderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid reorder payload" },
        { status: 400 },
      );
    }

    const { moduleId, topicIds } = parsed.data;

    const mod = await prisma.module.findFirst({
      where: { id: moduleId, subject: { userId: user.id } },
      include: { topics: { select: { id: true } } },
    });

    if (!mod) {
      return NextResponse.json({ error: "Module not found" }, { status: 404 });
    }

    const validIds = new Set(mod.topics.map((t) => t.id));
    const filteredIds = topicIds.filter((id) => validIds.has(id));

    await prisma.$transaction(
      filteredIds.map((id, idx) =>
        prisma.topic.update({
          where: { id },
          data: { order: idx },
        }),
      ),
    );

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Failed to reorder topics" },
      { status: 500 },
    );
  }
}
