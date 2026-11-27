import "server-only";
import * as webpush from "web-push";
import { prisma } from "./prisma";
import { expandCalendarEvents } from "./calendar-recurrence";

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

let cachedVapid: { publicKey: string; privateKey: string; subject: string } | null = null;

export async function getVapidConfig(): Promise<{
  publicKey: string;
  privateKey: string;
  subject: string;
}> {
  if (cachedVapid) return cachedVapid;

  const subject =
    process.env.VAPID_SUBJECT ||
    (process.env.BETTER_AUTH_URL?.startsWith("http")
      ? `mailto:admin@${new URL(process.env.BETTER_AUTH_URL).hostname}`
      : "mailto:admin@studysync.local");

  const envPub = process.env.VAPID_PUBLIC_KEY?.trim();
  const envPriv = process.env.VAPID_PRIVATE_KEY?.trim();
  if (envPub && envPriv) {
    cachedVapid = { publicKey: envPub, privateKey: envPriv, subject };
    webpush.setVapidDetails(subject, envPub, envPriv);
    return cachedVapid;
  }

  const [pubRow, privRow] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: "vapid_public_key" } }),
    prisma.appSetting.findUnique({ where: { key: "vapid_private_key" } }),
  ]);

  if (pubRow?.value && privRow?.value) {
    cachedVapid = {
      publicKey: pubRow.value,
      privateKey: privRow.value,
      subject,
    };
    webpush.setVapidDetails(subject, pubRow.value, privRow.value);
    return cachedVapid;
  }

  const generated = webpush.generateVAPIDKeys();
  await prisma.$transaction([
    prisma.appSetting.upsert({
      where: { key: "vapid_public_key" },
      create: { key: "vapid_public_key", value: generated.publicKey },
      update: { value: generated.publicKey },
    }),
    prisma.appSetting.upsert({
      where: { key: "vapid_private_key" },
      create: { key: "vapid_private_key", value: generated.privateKey },
      update: { value: generated.privateKey },
    }),
  ]);

  cachedVapid = {
    publicKey: generated.publicKey,
    privateKey: generated.privateKey,
    subject,
  };
  webpush.setVapidDetails(subject, generated.publicKey, generated.privateKey);
  return cachedVapid;
}

export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<{ sent: number; failed: number }> {
  await getVapidConfig();

  const subs = await prisma.pushSubscription.findMany({
    where: { userId },
  });

  if (subs.length === 0) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;
  const serialized = JSON.stringify(payload);

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        serialized,
      );
      sent++;
    } catch (err) {
      failed++;
      const statusCode =
        typeof err === "object" && err !== null && "statusCode" in err
          ? Number((err as { statusCode?: number }).statusCode)
          : 0;
      // Remove expired or unsubscribed browser endpoints cleanly
      if (statusCode === 404 || statusCode === 410) {
        await prisma.pushSubscription
          .delete({ where: { id: sub.id } })
          .catch(() => {});
      }
    }
  }

  return { sent, failed };
}

async function claimNotificationOnce(
  userId: string,
  dedupKey: string,
): Promise<boolean> {
  try {
    await prisma.notificationLog.create({
      data: { userId, dedupKey },
    });
    return true;
  } catch {
    // Unique constraint hit => already notified for this window
    return false;
  }
}

function formatDurationLabel(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const hrs = Math.round(mins / 60);
  return hrs === 1 ? "1 hour" : `${hrs} hours`;
}

export async function dispatchUpcomingReminders(nowInput?: Date): Promise<{
  checkedUsers: number;
  notificationsSent: number;
}> {
  const now = nowInput || new Date();

  const usersWithSubs = await prisma.user.findMany({
    where: { pushSubscriptions: { some: {} } },
    select: {
      id: true,
      notificationPref: true,
      calendarEvents: true,
      deadlines: {
        where: {
          status: { not: "COMPLETED" },
          dueAt: { gt: now },
        },
        include: { subject: { select: { name: true, code: true } } },
      },
    },
  });

  let notificationsSent = 0;

  for (const u of usersWithSubs) {
    const enabled = u.notificationPref?.enabled ?? true;
    if (!enabled) continue;

    const classLeadMinutes = Math.max(
      1,
      Math.min(180, u.notificationPref?.classLeadMinutes ?? 5),
    );
    const deadlineLeadHours = Math.max(
      1,
      Math.min(168, u.notificationPref?.deadlineLeadHours ?? 24),
    );

    // 1. Check upcoming calendar lectures/exams starting within classLeadMinutes
    if (u.calendarEvents.length > 0) {
      const windowStart = now;
      const windowEnd = new Date(
        now.getTime() + classLeadMinutes * 60 * 1000 + 59_000,
      );
      const dayBegin = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
      );
      const dayFinish = new Date(windowEnd.getTime() + 24 * 60 * 60 * 1000);
      const expanded = expandCalendarEvents(u.calendarEvents, dayBegin, dayFinish);

      for (const ev of expanded) {
        if (ev.allDay) continue;
        const startAt = new Date(ev.startAt);
        if (startAt <= windowStart || startAt > windowEnd) continue;

        const dedupKey = `ev:${u.id}:${ev.occurrenceId}:${classLeadMinutes}`;
        const claimed = await claimNotificationOnce(u.id, dedupKey);
        if (!claimed) continue;

        const minsLeft = Math.max(
          1,
          Math.round((startAt.getTime() - now.getTime()) / 60000),
        );
        const res = await sendPushToUser(u.id, {
          title: `${ev.eventType === "LAB" ? "Lab" : ev.eventType === "EXAM" ? "Exam" : "Class"} in ${formatDurationLabel(minsLeft)}: ${ev.title}`,
          body: `${startAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}${ev.location ? ` • Room ${ev.location}` : ""}`,
          url: "/calendar",
          tag: `class-${ev.occurrenceId}`,
        });
        if (res.sent > 0) notificationsSent += res.sent;
      }
    }

    // 2. Check pending deadlines due within deadlineLeadHours
    const dlCutoff = new Date(now.getTime() + deadlineLeadHours * 3600 * 1000);
    for (const dl of u.deadlines) {
      if (dl.dueAt <= now || dl.dueAt > dlCutoff) continue;

      const dedupKey = `dl:${u.id}:${dl.id}:${deadlineLeadHours}`;
      const claimed = await claimNotificationOnce(u.id, dedupKey);
      if (!claimed) continue;

      const hrsLeft = Math.max(
        1,
        Math.round((dl.dueAt.getTime() - now.getTime()) / 3600000),
      );
      const subjLabel = dl.subject?.code || dl.subject?.name;
      const res = await sendPushToUser(u.id, {
        title: `Upcoming ${dl.deadlineType.replace("_", " ")}: ${dl.title}`,
        body: `Due in ~${hrsLeft}h${subjLabel ? ` • ${subjLabel}` : ""}`,
        url: "/deadlines",
        tag: `dl-${dl.id}`,
      });
      if (res.sent > 0) notificationsSent += res.sent;
    }
  }

  // Prune old logs > 7 days asynchronously
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  await prisma.notificationLog
    .deleteMany({ where: { sentAt: { lt: weekAgo } } })
    .catch(() => {});

  return {
    checkedUsers: usersWithSubs.length,
    notificationsSent,
  };
}
