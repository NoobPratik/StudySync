import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getApiUser } from "@/lib/session";

const createScratchSchema = z.object({
  title: z.string().min(1, "Title is required").max(160),
  content: z.string().max(15000).default(""),
  rawContent: z.string().max(15000).optional().nullable(),
  color: z.string().default("#7C3AED"),
  pinned: z.boolean().default(false),
});

export async function GET() {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const scratchNotes = await prisma.scratchNote.findMany({
    where: { userId: user.id },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
  });

  return NextResponse.json({ scratchNotes });
}

export async function POST(request: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = createScratchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid note" },
        { status: 400 },
      );
    }

    const d = parsed.data;
    const note = await prisma.scratchNote.create({
      data: {
        userId: user.id,
        title: d.title.trim(),
        content: d.content,
        rawContent: d.rawContent ?? null,
        color: d.color,
        pinned: d.pinned,
      },
    });

    return NextResponse.json({ scratchNote: note }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Failed to create scratchpad note" },
      { status: 500 },
    );
  }
}
