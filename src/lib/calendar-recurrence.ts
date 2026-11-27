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

export function parseRecurrence(raw: string | null | undefined): RecurrenceRule | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as RecurrenceRule;
    if (!parsed || parsed.frequency === "NONE") return null;
    return parsed;
  } catch {
    return null;
  }
}

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function expandCalendarEvents(
  events: RawCalendarEvent[],
  rangeStart: Date,
  rangeEnd: Date,
): ExpandedCalendarEvent[] {
  const result: ExpandedCalendarEvent[] = [];
  const startDay = new Date(
    rangeStart.getFullYear(),
    rangeStart.getMonth(),
    rangeStart.getDate(),
    0,
    0,
    0,
  );
  const endDay = new Date(
    rangeEnd.getFullYear(),
    rangeEnd.getMonth(),
    rangeEnd.getDate(),
    23,
    59,
    59,
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

    const baseAnchorDay = new Date(
      baseStart.getFullYear(),
      baseStart.getMonth(),
      baseStart.getDate(),
      0,
      0,
      0,
    );
    const untilDate = rule.until
      ? new Date(`${rule.until.slice(0, 10)}T23:59:59`)
      : null;
    const effectiveStart = baseAnchorDay > startDay ? baseAnchorDay : startDay;
    const effectiveEnd =
      untilDate && untilDate < endDay ? untilDate : endDay;

    if (effectiveStart > effectiveEnd) continue;

    const exSet = new Set(rule.exDates || []);
    const allowedDays =
      rule.frequency === "WEEKLY"
        ? new Set(
            rule.daysOfWeek && rule.daysOfWeek.length > 0
              ? rule.daysOfWeek
              : [baseStart.getDay()],
          )
        : null;

    const cursor = new Date(effectiveStart);
    while (cursor <= effectiveEnd) {
      const dayMatches =
        rule.frequency === "DAILY" ||
        (allowedDays ? allowedDays.has(cursor.getDay()) : false);

      const dateKey = toDateKey(cursor);
      if (dayMatches && !exSet.has(dateKey)) {
        const occStart = new Date(
          cursor.getFullYear(),
          cursor.getMonth(),
          cursor.getDate(),
          baseStart.getHours(),
          baseStart.getMinutes(),
          baseStart.getSeconds(),
        );
        const occEnd = ev.allDay
          ? new Date(
              cursor.getFullYear(),
              cursor.getMonth(),
              cursor.getDate(),
              23,
              59,
              59,
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
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  result.sort(
    (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
  );
  return result;
}
