export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    const g = globalThis as unknown as { __studySyncNotifTimer?: NodeJS.Timeout };
    if (g.__studySyncNotifTimer) return;

    const { dispatchUpcomingReminders } = await import("./lib/notifications");
    g.__studySyncNotifTimer = setInterval(() => {
      dispatchUpcomingReminders().catch((err) => {
        console.error("[Push Scheduler] error:", err);
      });
    }, 60_000);
  }
}
