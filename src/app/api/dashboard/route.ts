import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getApiUser } from "@/lib/session";
import { expandCalendarEvents } from "@/lib/calendar-recurrence";
import { getZonedDayBounds, resolveTimeZone } from "@/lib/timezone";

const DEFAULT_CARD_ORDER = [
  "deadlines",
  "schedule",
  "pacing",
  "subjects",
  "notes",
];

export async function GET(request: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tz = resolveTimeZone(request.nextUrl.searchParams.get("tz"));
  const now = new Date();
  const { start: startOfToday, end: endOfToday } = getZonedDayBounds(now, tz);
  const in7Days = new Date(startOfToday.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [
    upcomingDeadlines,
    pendingDeadlinesCount,
    rawEvents,
    subjects,
    notesCount,
    recentNotes,
    todayFocusSessions,
    profile,
  ] = await Promise.all([
    prisma.deadline.findMany({
      where: {
        userId: user.id,
        status: { not: "COMPLETED" },
      },
      include: {
        subject: { select: { id: true, name: true, code: true, color: true } },
      },
      orderBy: { dueAt: "asc" },
      take: 6,
    }),
    prisma.deadline.count({
      where: {
        userId: user.id,
        status: { not: "COMPLETED" },
      },
    }),
    prisma.calendarEvent.findMany({
      where: { userId: user.id },
      orderBy: { startAt: "asc" },
    }),
    prisma.subject.findMany({
      where: { userId: user.id },
      include: {
        modules: {
          include: {
            topics: true,
          },
        },
      },
    }),
    prisma.note.count({ where: { userId: user.id } }),
    prisma.note.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        title: true,
        fileName: true,
        fileSize: true,
        uploadedAt: true,
        subject: { select: { id: true, name: true, code: true, color: true } },
      },
      orderBy: { uploadedAt: "desc" },
      take: 4,
    }),
    prisma.pomodoroSession.findMany({
      where: {
        userId: user.id,
        sessionType: "FOCUS",
        completedAt: { gte: startOfToday },
      },
      select: { duration: true },
    }),
    prisma.profile.findUnique({
      where: { userId: user.id },
      select: {
        program: true,
        branch: true,
        semester: true,
        semesterEndDate: true,
        dashboardOrder: true,
        aiBriefing: true,
      },
    }),
  ]);

  const allTodayEvents = expandCalendarEvents(rawEvents, startOfToday, endOfToday, tz);
  // Only show today's lectures/events that haven't finished yet (or all-day notices)
  const todayEvents = allTodayEvents.filter(
    (e) => e.allDay || new Date(e.endAt) > now,
  );
  const upcomingEvents = expandCalendarEvents(rawEvents, now, in7Days, tz)
    .filter((e) => e.allDay || new Date(e.endAt) > now)
    .slice(0, 6);

  let totalTopics = 0;
  let completedTopics = 0;

  const subjectProgress = subjects.map((sub) => {
    let subTotal = 0;
    let subDone = 0;
    for (const m of sub.modules) {
      for (const t of m.topics) {
        subTotal += 1;
        if (t.isCompleted) subDone += 1;
      }
    }
    totalTopics += subTotal;
    completedTopics += subDone;
    return {
      id: sub.id,
      name: sub.name,
      code: sub.code,
      color: sub.color,
      totalTopics: subTotal,
      completedTopics: subDone,
      percentage: subTotal > 0 ? Math.round((subDone / subTotal) * 100) : 0,
    };
  });

  const todayFocusMinutes = Math.round(
    todayFocusSessions.reduce((acc, s) => acc + s.duration, 0) / 60,
  );

  const remainingTopics = totalTopics - completedTopics;
  let daysLeft: number | null = null;
  let topicsPerDay: number | null = null;

  if (profile?.semesterEndDate) {
    const diffMs = new Date(profile.semesterEndDate).getTime() - now.getTime();
    daysLeft = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    if (remainingTopics > 0) {
      topicsPerDay =
        daysLeft > 0
          ? Number((remainingTopics / daysLeft).toFixed(1))
          : remainingTopics;
    } else {
      topicsPerDay = 0;
    }
  }

  let cardOrder = DEFAULT_CARD_ORDER;
  if (profile?.dashboardOrder) {
    try {
      const parsed = JSON.parse(profile.dashboardOrder);
      if (Array.isArray(parsed) && parsed.length > 0) {
        cardOrder = parsed;
      }
    } catch {
      cardOrder = DEFAULT_CARD_ORDER;
    }
  }

  let aiBriefing: { summary: string; updatedAt: string; reason?: string } | null =
    null;
  if (profile?.aiBriefing) {
    try {
      aiBriefing = JSON.parse(profile.aiBriefing);
    } catch {
      aiBriefing = null;
    }
  }

  return NextResponse.json({
    stats: {
      pendingDeadlines: pendingDeadlinesCount,
      todayEventsCount: todayEvents.length,
      todayFocusMinutes,
      todaySessionsCount: todayFocusSessions.length,
      notesCount,
      subjectsCount: subjects.length,
      totalTopics,
      completedTopics,
      remainingTopics,
      overallProgress:
        totalTopics > 0 ? Math.round((completedTopics / totalTopics) * 100) : 0,
      daysLeft,
      topicsPerDay,
    },
    upcomingDeadlines,
    todayEvents,
    upcomingEvents,
    subjectProgress,
    recentNotes,
    profile,
    cardOrder,
    aiBriefing,
  });
}

const orderSchema = z.object({
  cardOrder: z.array(z.string()).min(1).max(10),
});

export async function PATCH(request: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = orderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid card order" }, { status: 400 });
  }

  await prisma.profile.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      dashboardOrder: JSON.stringify(parsed.data.cardOrder),
    },
    update: {
      dashboardOrder: JSON.stringify(parsed.data.cardOrder),
    },
  });

  return NextResponse.json({ cardOrder: parsed.data.cardOrder });
}
