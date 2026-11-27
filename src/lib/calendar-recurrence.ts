import {
  getZonedParts,
  resolveTimeZone,
  zonedWallTimeToUtc,
} from "./timezone";

export interface RecurrenceRule {
  frequency: "NONE" | "DAILY" | "WEEKLY";
  daysOfWeek?: number[]; // 0 = Sun, 1 = Mon ... 6 = Sat
  until?: string | null; // ISO date string YYYY-MM-DD
  exDates?: string[]; // YYYY-MM-DD dates to skip
}

export interface RawCalendarEvent {
  id: string;
  title: string;
  description: string | null;
  eventType: string;
  startAt: Date | string;
  endAt: Date | string;
  allDay: boolean;
  recurrence: string | null;
  color: string | null;
  location: string | null;
}

export interface ExpandedCalendarEvent {
  id: string; // original event id
  occurrenceId: string; // unique per date occurrence
  title: string;
  description: string | null;
  eventType: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  recurrence: RecurrenceRule | null;
  isRecurring: boolean;
  color: string | null;
  location: string | null;
}

interface WallDate {
  year: number;
  month: number;
  day: number;
}

export function parseRecurrence(
  raw: string | null | undefined,
): RecurrenceRule | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as RecurrenceRule;
    if (!parsed || parsed.frequency === "NONE") return null;
    return parsed;
  } catch {
    return null;
  }
}

function toWallDateKey(d: WallDate): string {
  const m = String(d.month).padStart(2, "0");
  const day = String(d.day).padStart(2, "0");
  return `${d.year}-${m}-${day}`;
}

function compareWallDates(a: WallDate, b: WallDate): number {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}

function addWallDays(d: WallDate, days: number): WallDate {
  const next = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

function getWallDayOfWeek(d: WallDate): number {
  return new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
}

function parseWallDateString(raw: string): WallDate | null {
  const match = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

export function expandCalendarEvents(
  events: RawCalendarEvent[],
  rangeStart: Date,
  rangeEnd: Date,
  timeZone?: string | null,
): ExpandedCalendarEvent[] {
  const tz = resolveTimeZone(timeZone);
  const result: ExpandedCalendarEvent[] = [];

  const rangeStartParts = getZonedParts(rangeStart, tz);
  const rangeEndParts = getZonedParts(rangeEnd, tz);
  const rangeStartDate: WallDate = {
    year: rangeStartParts.year,
    month: rangeStartParts.month,
    day: rangeStartParts.day,
  };
  const rangeEndDate: WallDate = {
    year: rangeEndParts.year,
    month: rangeEndParts.month,
    day: rangeEndParts.day,
  };

  const startDay = zonedWallTimeToUtc(
    { ...rangeStartDate, hour: 0, minute: 0, second: 0 },
    tz,
  );
  const endDay = zonedWallTimeToUtc(
    { ...rangeEndDate, hour: 23, minute: 59, second: 59 },
    tz,
  );

  for (const ev of events) {
    const baseStart = new Date(ev.startAt);
    const baseEnd = new Date(ev.endAt);
    const durationMs = Math.max(0, baseEnd.getTime() - baseStart.getTime());
    const rule = parseRecurrence(ev.recurrence);

    if (!rule) {
      if (baseEnd >= startDay && baseStart <= endDay) {
        result.push({
          id: ev.id,
          occurrenceId: ev.id,
          title: ev.title,
          description: ev.description,
          eventType: ev.eventType,
          startAt: baseStart.toISOString(),
          endAt: baseEnd.toISOString(),
          allDay: ev.allDay,
          recurrence: null,
          isRecurring: false,
          color: ev.color,
          location: ev.location,
        });
      }
      continue;
    }

    const baseParts = getZonedParts(baseStart, tz);
    const baseAnchorDate: WallDate = {
      year: baseParts.year,
      month: baseParts.month,
      day: baseParts.day,
    };
    const untilDate = rule.until ? parseWallDateString(rule.until) : null;

    const effectiveStart =
      compareWallDates(baseAnchorDate, rangeStartDate) > 0
        ? baseAnchorDate
        : rangeStartDate;
    const effectiveEnd =
      untilDate && compareWallDates(untilDate, rangeEndDate) < 0
        ? untilDate
        : rangeEndDate;

    if (compareWallDates(effectiveStart, effectiveEnd) > 0) continue;

    const exSet = new Set(rule.exDates || []);
    const allowedDays =
      rule.frequency === "WEEKLY"
        ? new Set(
            rule.daysOfWeek && rule.daysOfWeek.length > 0
              ? rule.daysOfWeek
              : [baseParts.dayOfWeek],
          )
        : null;

    let cursor = effectiveStart;
    while (compareWallDates(cursor, effectiveEnd) <= 0) {
      const cursorDow = getWallDayOfWeek(cursor);
      const dayMatches =
        rule.frequency === "DAILY" ||
        (allowedDays ? allowedDays.has(cursorDow) : false);

      const dateKey = toWallDateKey(cursor);
      if (dayMatches && !exSet.has(dateKey)) {
        const occStart = ev.allDay
          ? zonedWallTimeToUtc(
              { ...cursor, hour: 0, minute: 0, second: 0 },
              tz,
            )
          : zonedWallTimeToUtc(
              {
                ...cursor,
                hour: baseParts.hour,
                minute: baseParts.minute,
                second: baseParts.second,
              },
              tz,
            );
        const occEnd = ev.allDay
          ? zonedWallTimeToUtc(
              { ...cursor, hour: 23, minute: 59, second: 59 },
              tz,
            )
          : new Date(occStart.getTime() + durationMs);

        result.push({
          id: ev.id,
          occurrenceId: `${ev.id}_${dateKey}`,
          title: ev.title,
          description: ev.description,
          eventType: ev.eventType,
          startAt: occStart.toISOString(),
          endAt: occEnd.toISOString(),
          allDay: ev.allDay,
          recurrence: rule,
          isRecurring: true,
          color: ev.color,
          location: ev.location,
        });
      }
      cursor = addWallDays(cursor, 1);
    }
  }

  result.sort(
    (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
  );
  return result;
}
