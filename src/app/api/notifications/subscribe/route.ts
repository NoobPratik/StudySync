import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getApiUser } from "@/lib/session";

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export async function POST(request: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = subscribeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid push subscription payload" },
        { status: 400 },
      );
    }

    const { endpoint, keys } = parsed.data;
    const userAgent = request.headers.get("user-agent") || null;

    await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: {
        userId: user.id,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent,
      },
      update: {
        userId: user.id,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent,
      },
    });

    await prisma.notificationPreference.upsert({
      where: { userId: user.id },
      create: { userId: user.id, enabled: true },
      update: { enabled: true },
    });

    const subscriptionCount = await prisma.pushSubscription.count({
      where: { userId: user.id },
    });

    return NextResponse.json({ ok: true, subscriptionCount }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Failed to save push subscription" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";

  if (endpoint) {
    await prisma.pushSubscription.deleteMany({
      where: { userId: user.id, endpoint },
    });
  } else {
    await prisma.pushSubscription.deleteMany({ where: { userId: user.id } });
  }

  const subscriptionCount = await prisma.pushSubscription.count({
    where: { userId: user.id },
  });

  return NextResponse.json({ ok: true, subscriptionCount });
}
