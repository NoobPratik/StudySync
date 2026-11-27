import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/session";
import { dispatchUpcomingReminders } from "@/lib/notifications";

export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET || process.env.BETTER_AUTH_SECRET;
  const headerSecret = request.headers.get("x-cron-secret");

  if (!cronSecret || headerSecret !== cronSecret) {
    const user = await getApiUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const stats = await dispatchUpcomingReminders();
  return NextResponse.json({ ok: true, ...stats });
}
