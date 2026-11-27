import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getApiUser } from "@/lib/session";
import { getEventTypeColor } from "@/lib/utils";
import { expandCalendarEvents } from "@/lib/calendar-recurrence";
import { resolveTimeZone } from "@/lib/timezone";

const recurrenceSchema = z
  .object({
    frequency: z.enum(["NONE", "DAILY", "WEEKLY"]).default("NONE"),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
    until: z.string().nullable().optional(),
    exDates: z.array(z.string()).optional(),
  })
  .nullable()
  .optional();

const createEventSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().max(1000).optional().nullable(),
  eventType: z
    .enum(["LECTURE", "HOLIDAY", "EXAM", "LAB", "CUSTOM"])
    .default("CUSTOM"),
  startAt: z.string().min(1),
  endAt: z.string().min(1),
  allDay: z.boolean().default(false),
  color: z.string().optional().nullable(),
  location: z.string().max(200).optional().nullable(),
  recurrence: z.union([z.string(), recurrenceSchema]).optional(),
});

export async function GET(request: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const startParam = searchParams.get("start");
  const endParam = searchParams.get("end");
  const eventType = searchParams.get("type");
  const tz = resolveTimeZone(searchParams.get("tz"));

  const now = new Date();
  const rangeStart = startParam
    ? new Date(startParam)
    : new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const rangeEnd = endParam
    ? new Date(endParam)
    : new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59);

  const rawEvents = await prisma.calendarEvent.findMany({
    where: {
      userId: user.id,
      ...(eventType && eventType !== "ALL" ? { eventType } : {}),
    },
    orderBy: { startAt: "asc" },
  });

  const events = expandCalendarEvents(rawEvents, rangeStart, rangeEnd, tz);

  return NextResponse.json({ events, rawEvents });
}

const bulkDeleteSchema = z.object({
  scope: z.enum(["all", "recurring", "selected"]).default("all"),
  ids: z.array(z.string().min(1)).optional(),
  eventType: z
    .enum(["LECTURE", "HOLIDAY", "EXAM", "LAB", "CUSTOM"])
    .optional(),
});

export async function DELETE(request: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    let rawBody: unknown = {};
    const text = await request.text();
    if (text.trim()) {
      rawBody = JSON.parse(text);
    }

    const parsed = bulkDeleteSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid delete request" },
        { status: 400 },
      );
    }

    const { scope, ids, eventType } = parsed.data;

    if (scope === "selected") {
      if (!ids || ids.length === 0) {
        return NextResponse.json(
          { error: "Select at least one event series to delete" },
          { status: 400 },
        );
      }
      const res = await prisma.calendarEvent.deleteMany({
        where: { userId: user.id, id: { in: ids } },
      });
      return NextResponse.json({ deletedCount: res.count });
    }

    if (scope === "recurring") {
      const res = await prisma.calendarEvent.deleteMany({
        where: {
          userId: user.id,
          recurrence: { not: null },
          ...(eventType ? { eventType } : {}),
        },
      });
      return NextResponse.json({ deletedCount: res.count });
    }

    const res = await prisma.calendarEvent.deleteMany({
      where: {
        userId: user.id,
        ...(eventType ? { eventType } : {}),
      },
    });
    return NextResponse.json({ deletedCount: res.count });
  } catch {
    return NextResponse.json(
      { error: "Failed to clear calendar events" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = createEventSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid event data" },
        { status: 400 },
      );
    }

    const data = parsed.data;
    const startAt = new Date(data.startAt);
    const endAt = new Date(data.endAt);

    if (isNaN(startAt.getTime()) || isNaN(endAt.getTime())) {
      return NextResponse.json(
        { error: "Invalid start or end date" },
        { status: 400 },
      );
    }

    let recurrenceStr: string | null = null;
    if (data.recurrence) {
      if (typeof data.recurrence === "string") {
        recurrenceStr = data.recurrence;
      } else if (data.recurrence.frequency !== "NONE") {
        recurrenceStr = JSON.stringify(data.recurrence);
      }
    }

    const event = await prisma.calendarEvent.create({
      data: {
        userId: user.id,
        title: data.title.trim(),
        description: data.description?.trim() || null,
        eventType: data.eventType,
        startAt,
        endAt: endAt < startAt ? startAt : endAt,
        allDay: data.allDay,
        color: data.color || getEventTypeColor(data.eventType),
        location: data.location?.trim() || null,
        recurrence: recurrenceStr,
      },
    });

    return NextResponse.json({ event }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Failed to create event" },
      { status: 500 },
    );
  }
}
