import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getApiUser } from "@/lib/session";
import { getVapidConfig } from "@/lib/notifications";

const updatePrefsSchema = z.object({
  enabled: z.boolean().optional(),
  classLeadMinutes: z.number().int().min(1).max(180).optional(),
  deadlineLeadHours: z.number().int().min(1).max(168).optional(),
});

export async function GET() {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [pref, subCount, vapid] = await Promise.all([
    prisma.notificationPreference.findUnique({ where: { userId: user.id } }),
    prisma.pushSubscription.count({ where: { userId: user.id } }),
    getVapidConfig(),
  ]);

  return NextResponse.json({
    preferences: {
      enabled: pref?.enabled ?? true,
      classLeadMinutes: pref?.classLeadMinutes ?? 5,
      deadlineLeadHours: pref?.deadlineLeadHours ?? 24,
    },
    subscriptionCount: subCount,
    vapidPublicKey: vapid.publicKey,
  });
}

export async function PUT(request: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = updatePrefsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid notification settings" },
        { status: 400 },
      );
    }

    const d = parsed.data;
    const saved = await prisma.notificationPreference.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        enabled: d.enabled ?? true,
        classLeadMinutes: d.classLeadMinutes ?? 5,
        deadlineLeadHours: d.deadlineLeadHours ?? 24,
      },
      update: {
        ...(d.enabled !== undefined ? { enabled: d.enabled } : {}),
        ...(d.classLeadMinutes !== undefined
          ? { classLeadMinutes: d.classLeadMinutes }
          : {}),
        ...(d.deadlineLeadHours !== undefined
          ? { deadlineLeadHours: d.deadlineLeadHours }
          : {}),
      },
    });

    return NextResponse.json({
      preferences: {
        enabled: saved.enabled,
        classLeadMinutes: saved.classLeadMinutes,
        deadlineLeadHours: saved.deadlineLeadHours,
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to save notification preferences" },
      { status: 500 },
    );
  }
}
