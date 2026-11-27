import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getApiUser } from "@/lib/session";
import { getEventTypeColor } from "@/lib/utils";
import {
  getZonedParts,
  resolveTimeZone,
  zonedWallTimeToUtc,
} from "@/lib/timezone";

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
  items: z
    .array(bulkItemSchema)
    .min(1, "Select at least one class to import")
    .max(80),
  startDate: z.string().optional(),
  timeZone: z.string().max(100).optional(),
});

function nextOccurrenceDate(
  anchor: { year: number; month: number; day: number },
  targetDow: number,
): { year: number; month: number; day: number } {
  const baseUtc = new Date(
    Date.UTC(anchor.year, anchor.month - 1, anchor.day),
  );
  const diff = (targetDow - baseUtc.getUTCDay() + 7) % 7;
  baseUtc.setUTCDate(baseUtc.getUTCDate() + diff);
  return {
    year: baseUtc.getUTCFullYear(),
    month: baseUtc.getUTCMonth() + 1,
    day: baseUtc.getUTCDate(),
  };
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

    const tz = resolveTimeZone(parsed.data.timeZone);
    const startDateMatch = parsed.data.startDate
      ?.trim()
      .match(/^(\d{4})-(\d{2})-(\d{2})/);
    const anchorParts = startDateMatch
      ? {
          year: Number(startDateMatch[1]),
          month: Number(startDateMatch[2]),
          day: Number(startDateMatch[3]),
        }
      : getZonedParts(new Date(), tz);

    const created = await prisma.$transaction(
      parsed.data.items.map((item) => {
        const occDay = nextOccurrenceDate(anchorParts, item.dayOfWeek);
        const [startHour, startMinute] = item.startTime.split(":").map(Number);
        const [endHour, endMinute] = item.endTime.split(":").map(Number);

        const startAt = zonedWallTimeToUtc(
          {
            year: occDay.year,
            month: occDay.month,
            day: occDay.day,
            hour: startHour,
            minute: startMinute,
            second: 0,
          },
          tz,
        );
        let endAt = zonedWallTimeToUtc(
          {
            year: occDay.year,
            month: occDay.month,
            day: occDay.day,
            hour: endHour,
            minute: endMinute,
            second: 0,
          },
          tz,
        );
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
