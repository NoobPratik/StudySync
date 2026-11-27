import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getApiUser } from "@/lib/session";

const updateTodoSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  category: z.enum(["GENERAL", "COLLEGE", "ERRAND", "PERSONAL"]).optional(),
  isCompleted: z.boolean().optional(),
  dueDate: z.string().optional().nullable(),
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
  const existing = await prisma.todoItem.findFirst({
    where: { id, userId: user.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = updateTodoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  }

  const d = parsed.data;
  const todo = await prisma.todoItem.update({
    where: { id },
    data: {
      ...(d.title !== undefined ? { title: d.title.trim() } : {}),
      ...(d.category !== undefined ? { category: d.category } : {}),
      ...(d.isCompleted !== undefined ? { isCompleted: d.isCompleted } : {}),
      ...(d.dueDate !== undefined
        ? { dueDate: d.dueDate ? new Date(d.dueDate) : null }
        : {}),
    },
  });

  return NextResponse.json({ todo });
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
  const existing = await prisma.todoItem.findFirst({
    where: { id, userId: user.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.todoItem.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
