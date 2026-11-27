import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getApiUser } from "@/lib/session";

const createTodoSchema = z.object({
  title: z.string().min(1, "Task title is required").max(200),
  category: z
    .enum(["GENERAL", "COLLEGE", "ERRAND", "PERSONAL"])
    .default("GENERAL"),
  dueDate: z.string().optional().nullable(),
});

export async function GET() {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const todos = await prisma.todoItem.findMany({
    where: { userId: user.id },
    orderBy: [{ isCompleted: "asc" }, { createdAt: "desc" }],
  });

  return NextResponse.json({ todos });
}

export async function POST(request: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = createTodoSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid todo" },
        { status: 400 },
      );
    }

    const d = parsed.data;
    const dueDate =
      d.dueDate && d.dueDate !== "" ? new Date(d.dueDate) : null;

    const todo = await prisma.todoItem.create({
      data: {
        userId: user.id,
        title: d.title.trim(),
        category: d.category,
        dueDate: dueDate && !isNaN(dueDate.getTime()) ? dueDate : null,
      },
    });

    return NextResponse.json({ todo }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Failed to create todo" },
      { status: 500 },
    );
  }
}
