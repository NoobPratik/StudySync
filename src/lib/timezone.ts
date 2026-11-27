export const DEFAULT_TIME_ZONE =
  process.env.APP_TIMEZONE || process.env.TZ || "Asia/Kolkata";

export interface WallClockParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
  second: number; // 0-59
}

export interface ZonedDateParts extends WallClockParts {
  dayOfWeek: number; // 0 = Sun ... 6 = Sat
}

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getPartsFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    });
    formatterCache.set(timeZone, fmt);
  }
  return fmt;
}

export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz || typeof tz !== "string") return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function resolveTimeZone(tz?: string | null): string {
  if (isValidTimeZone(tz)) return tz;
  if (isValidTimeZone(DEFAULT_TIME_ZONE)) return DEFAULT_TIME_ZONE;
  return "UTC";
}

export function getBrowserTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (isValidTimeZone(tz)) return tz;
  } catch {
    // Fallback below
  }
  return "Asia/Kolkata";
}

export function getShortTimeZoneName(timeZone?: string | null): string {
  const tz = resolveTimeZone(timeZone);
  try {
    const parts = new Intl.DateTimeFormat("en-IN", {
      timeZone: tz,
      timeZoneName: "short",
    }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value || tz;
  } catch {
    return tz;
  }
}

export function getZonedParts(date: Date, timeZone: string): ZonedDateParts {
  const tz = resolveTimeZone(timeZone);
  const parts = getPartsFormatter(tz).formatToParts(date);
  let year = 1970;
  let month = 1;
  let day = 1;
  let hour = 0;
  let minute = 0;
  let second = 0;
  let dayOfWeek = 0;

  for (const part of parts) {
    switch (part.type) {
      case "year":
        year = Number(part.value);
        break;
      case "month":
        month = Number(part.value);
        break;
      case "day":
        day = Number(part.value);
        break;
      case "hour":
        hour = Number(part.value) % 24;
        break;
      case "minute":
        minute = Number(part.value);
        break;
      case "second":
        second = Number(part.value);
        break;
      case "weekday":
        dayOfWeek = WEEKDAY_MAP[part.value] ?? 0;
        break;
    }
  }

  return { year, month, day, hour, minute, second, dayOfWeek };
}

export function zonedWallTimeToUtc(
  parts: WallClockParts,
  timeZone: string,
): Date {
  const tz = resolveTimeZone(timeZone);
  const targetMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  let candidate = new Date(targetMs);

  for (let i = 0; i < 2; i++) {
    const observed = getZonedParts(candidate, tz);
    const observedMs = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
    );
    const diff = targetMs - observedMs;
    if (diff === 0) break;
    candidate = new Date(candidate.getTime() + diff);
  }

  return candidate;
}

export function getZonedDayBounds(
  date: Date,
  timeZone: string,
): { start: Date; end: Date } {
  const tz = resolveTimeZone(timeZone);
  const p = getZonedParts(date, tz);
  return {
    start: zonedWallTimeToUtc(
      { year: p.year, month: p.month, day: p.day, hour: 0, minute: 0, second: 0 },
      tz,
    ),
    end: zonedWallTimeToUtc(
      { year: p.year, month: p.month, day: p.day, hour: 23, minute: 59, second: 59 },
      tz,
    ),
  };
}
