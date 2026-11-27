import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getApiUser } from "@/lib/session";
import { getEventTypeColor } from "@/lib/utils";

const bulkItemSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional().nullable(),
  eventType: z
    .enum(["LECTURE", "HOLIDAY", "EXAM", "LAB", "CUSTOM"])
    .default("LECTURE"),
  dayOfWeek: z.number().int().min(0).max(6), // 0 = Sun, 1 = Mon ... 6 = Sat
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  location: z.string().max(200).optional().nullable(),
  repeatUntil: z.string().optional().nullable(),
});

const bulkCreateSchema = z.object({
  items: z.array(bulkItemSchema).min(1, "Select at least one class to import").max(80),
  startDate: z.string().optional(),
});

function nextOccurrenceOnOrAfter(baseDate: Date, targetDow: number): Date {
  const d = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  const diff = (targetDow - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + diff);
  return d;
}

export async function POST(request: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = bulkCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid timetable items" },
        { status: 400 },
      );
    }

    const baseDate = parsed.data.startDate
      ? new Date(`${parsed.data.startDate.slice(0, 10)}T00:00:00`)
      : new Date();
    const anchorBase = isNaN(baseDate.getTime()) ? new Date() : baseDate;

    const created = await prisma.$transaction(
      parsed.data.items.map((item) => {
        const occDay = nextOccurrenceOnOrAfter(anchorBase, item.dayOfWeek);
        const yyyy = occDay.getFullYear();
        const mm = String(occDay.getMonth() + 1).padStart(2, "0");
        const dd = String(occDay.getDate()).padStart(2, "0");

        const startAt = new Date(`${yyyy}-${mm}-${dd}T${item.startTime}:00`);
        let endAt = new Date(`${yyyy}-${mm}-${dd}T${item.endTime}:00`);
        if (endAt <= startAt) {
          endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
        }

        const recurrence = JSON.stringify({
          frequency: "WEEKLY",
          daysOfWeek: [item.dayOfWeek],
          until: item.repeatUntil || null,
          exDates: [],
        });

        return prisma.calendarEvent.create({
          data: {
            userId: user.id,
            title: item.title.trim(),
            description: item.description?.trim() || null,
            eventType: item.eventType,
            startAt,
            endAt,
            allDay: false,
            color: getEventTypeColor(item.eventType),
            location: item.location?.trim() || null,
            recurrence,
          },
        });
      }),
    );

    return NextResponse.json(
      { createdCount: created.length },
      { status: 201 },
    );
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to bulk import calendar",
      },
      { status: 500 },
    );
  }
}
