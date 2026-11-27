import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getApiUser } from "@/lib/session";
import { parseRecurrence } from "@/lib/calendar-recurrence";

const recurrenceSchema = z
  .object({
    frequency: z.enum(["NONE", "DAILY", "WEEKLY"]).default("NONE"),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
    until: z.string().nullable().optional(),
    exDates: z.array(z.string()).optional(),
  })
  .nullable()
  .optional();

const updateEventSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional().nullable(),
  eventType: z.enum(["LECTURE", "HOLIDAY", "EXAM", "LAB", "CUSTOM"]).optional(),
  startAt: z.string().optional(),
  endAt: z.string().optional(),
  allDay: z.boolean().optional(),
  color: z.string().optional().nullable(),
  location: z.string().max(200).optional().nullable(),
  recurrence: z.union([z.string(), recurrenceSchema]).optional(),
  skipDate: z.string().optional(), // YYYY-MM-DD to skip a single occurrence
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
  const existing = await prisma.calendarEvent.findFirst({
    where: { id, userId: user.id },
  });

  if (!existing) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  try {
    const body = await request.json();
    const parsed = updateEventSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid data" },
        { status: 400 },
      );
    }

    const d = parsed.data;
    let recurrenceUpdate: string | null | undefined = undefined;

    if (d.skipDate) {
      const currentRule = parseRecurrence(existing.recurrence);
      if (currentRule) {
        const exDates = Array.from(
          new Set([...(currentRule.exDates || []), d.skipDate]),
        );
        recurrenceUpdate = JSON.stringify({ ...currentRule, exDates });
      }
    } else if (d.recurrence !== undefined) {
      if (d.recurrence === null) {
        recurrenceUpdate = null;
      } else if (typeof d.recurrence === "string") {
        recurrenceUpdate = d.recurrence;
      } else if (d.recurrence.frequency === "NONE") {
        recurrenceUpdate = null;
      } else {
        recurrenceUpdate = JSON.stringify(d.recurrence);
      }
    }

    const event = await prisma.calendarEvent.update({
      where: { id },
      data: {
        ...(d.title !== undefined ? { title: d.title.trim() } : {}),
        ...(d.description !== undefined
          ? { description: d.description?.trim() || null }
          : {}),
        ...(d.eventType !== undefined ? { eventType: d.eventType } : {}),
        ...(d.startAt !== undefined ? { startAt: new Date(d.startAt) } : {}),
        ...(d.endAt !== undefined ? { endAt: new Date(d.endAt) } : {}),
        ...(d.allDay !== undefined ? { allDay: d.allDay } : {}),
        ...(d.color !== undefined ? { color: d.color } : {}),
        ...(d.location !== undefined
          ? { location: d.location?.trim() || null }
          : {}),
        ...(recurrenceUpdate !== undefined
          ? { recurrence: recurrenceUpdate }
          : {}),
      },
    });

    return NextResponse.json({ event });
  } catch {
    return NextResponse.json(
      { error: "Failed to update event" },
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
  const existing = await prisma.calendarEvent.findFirst({
    where: { id, userId: user.id },
  });

  if (!existing) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  await prisma.calendarEvent.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
