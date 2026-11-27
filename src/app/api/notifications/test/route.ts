import { NextResponse } from "next/server";
import { getApiUser } from "@/lib/session";
import { sendPushToUser } from "@/lib/notifications";

export async function POST() {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await sendPushToUser(user.id, {
    title: "StudySync Push Alerts Active",
    body: "You will be notified before upcoming lectures and deadlines!",
    url: "/settings",
    tag: "studysync-test",
  });

  if (result.sent === 0) {
    return NextResponse.json(
      {
        error:
          "No active push subscription found on this device yet. Click 'Enable Push Notifications' first.",
      },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, ...result });
}
