import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiUser } from "@/lib/session";
import {
  buildStudentContext,
  callAiChat,
  extractJsonFromAi,
} from "@/lib/ai";
import { AI_PROMPTS } from "@/lib/ai-prompts";

const VALID_CARDS = ["deadlines", "schedule", "pacing", "subjects", "notes"];
const VALID_LAYOUTS = [
  "BENTO_360",
  "EXAM_SPRINT",
  "DEEP_STUDY",
  "DAILY_AGENDA",
] as const;

export async function POST(request: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const context = await buildStudentContext(user.id);
    const aiRequest = AI_PROMPTS.dashboardPrioritize(context);

    const { content } = await callAiChat({
      userId: user.id,
      logFeature: "dashboard_prioritize",
      signal: request.signal,
      ...aiRequest,
    });

    const parsed = extractJsonFromAi<{
      layoutMode?: string;
      cardOrder?: string[];
      headline?: string;
      summary?: string;
      reason?: string;
      focusTip?: string;
      primaryAction?: { label?: string; href?: string };
    }>(content);

    const sanitizedOrder = Array.isArray(parsed.cardOrder)
      ? parsed.cardOrder.filter((k) => VALID_CARDS.includes(k))
      : [];
    for (const k of VALID_CARDS) {
      if (!sanitizedOrder.includes(k)) sanitizedOrder.push(k);
    }

    const layoutMode = VALID_LAYOUTS.includes(
      parsed.layoutMode as (typeof VALID_LAYOUTS)[number],
    )
      ? parsed.layoutMode
      : "BENTO_360";

    const allowedHrefs = new Set([
      "/chat",
      "/deadlines",
      "/practice",
      "/progress",
      "/calendar",
      "/notes",
      "/pomodoro",
    ]);
    const rawHref = parsed.primaryAction?.href || "/chat";
    const safeAction = {
      label: parsed.primaryAction?.label?.trim() || "Open AI Tutor",
      href: allowedHrefs.has(rawHref) ? rawHref : "/chat",
    };

    const briefing = {
      layoutMode,
      headline: parsed.headline?.trim() || "Today's Adaptive Study Cockpit",
      summary:
        parsed.summary ||
        "Prioritized your workspace based on upcoming deadlines and classes.",
      reason: parsed.reason || "AI Smart Priority",
      focusTip:
        parsed.focusTip?.trim() ||
        "Focus on one remaining module topic before switching tasks.",
      primaryAction: safeAction,
      updatedAt: new Date().toISOString(),
    };

    await prisma.profile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        dashboardOrder: JSON.stringify(sanitizedOrder),
        aiBriefing: JSON.stringify(briefing),
      },
      update: {
        dashboardOrder: JSON.stringify(sanitizedOrder),
        aiBriefing: JSON.stringify(briefing),
      },
    });

    return NextResponse.json({
      cardOrder: sanitizedOrder,
      aiBriefing: briefing,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to prioritize dashboard",
      },
      { status: 400 },
    );
  }
}
