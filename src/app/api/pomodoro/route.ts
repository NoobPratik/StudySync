import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getApiUser } from "@/lib/session";

const createSessionSchema = z.object({
  subjectId: z.string().optional().nullable(),
  duration: z.number().int().min(10).max(14400),
  breakDuration: z.number().int().min(0).max(3600).default(300),
  sessionType: z
    .enum(["FOCUS", "SHORT_BREAK", "LONG_BREAK"])
    .default("FOCUS"),
});

export async function GET() {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - 6);

  const [sessions, allFocusSessions] = await Promise.all([
    prisma.pomodoroSession.findMany({
      where: { userId: user.id },
      include: {
        subject: {
          select: { id: true, name: true, code: true, color: true },
        },
      },
      orderBy: { completedAt: "desc" },
      take: 30,
    }),
    prisma.pomodoroSession.findMany({
      where: { userId: user.id, sessionType: "FOCUS" },
      select: { duration: true, completedAt: true },
    }),
  ]);

  let todaySeconds = 0;
  let todayCount = 0;
  let weekSeconds = 0;
  let totalSeconds = 0;

  for (const s of allFocusSessions) {
    totalSeconds += s.duration;
    if (s.completedAt >= startOfToday) {
      todaySeconds += s.duration;
      todayCount += 1;
    }
    if (s.completedAt >= startOfWeek) {
      weekSeconds += s.duration;
    }
  }

  return NextResponse.json({
    sessions,
    stats: {
      todayMinutes: Math.round(todaySeconds / 60),
      todayCount,
      weekMinutes: Math.round(weekSeconds / 60),
      totalMinutes: Math.round(totalSeconds / 60),
      totalCount: allFocusSessions.length,
    },
  });
}

export async function POST(request: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = createSessionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid session data" },
        { status: 400 },
      );
    }

    const d = parsed.data;
    if (d.subjectId) {
      const subject = await prisma.subject.findFirst({
        where: { id: d.subjectId, userId: user.id },
      });
      if (!subject) {
        return NextResponse.json(
          { error: "Subject not found" },
          { status: 404 },
        );
      }
    }

    const session = await prisma.pomodoroSession.create({
      data: {
        userId: user.id,
        subjectId: d.subjectId || null,
        duration: d.duration,
        breakDuration: d.breakDuration,
        sessionType: d.sessionType,
      },
      include: {
        subject: {
          select: { id: true, name: true, code: true, color: true },
        },
      },
    });

    return NextResponse.json({ session }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Failed to log Pomodoro session" },
      { status: 500 },
    );
  }
}
