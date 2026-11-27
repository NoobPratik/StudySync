import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiUser } from "@/lib/session";
import {
  buildStudentContext,
  callAiChat,
  extractJsonFromAi,
} from "@/lib/ai";
import { AI_PROMPTS } from "@/lib/ai-prompts";

const VALID_CARDS = ["deadlines", "schedule", "pacing", "subjects", "notes"];

export async function POST() {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const context = await buildStudentContext(user.id);
    const aiRequest = AI_PROMPTS.dashboardPrioritize(context);

    const { content } = await callAiChat({
      userId: user.id,
      ...aiRequest,
    });

    const parsed = extractJsonFromAi<{
      cardOrder?: string[];
      summary?: string;
      reason?: string;
    }>(content);

    const sanitizedOrder = Array.isArray(parsed.cardOrder)
      ? parsed.cardOrder.filter((k) => VALID_CARDS.includes(k))
      : [];
    for (const k of VALID_CARDS) {
      if (!sanitizedOrder.includes(k)) sanitizedOrder.push(k);
    }

    const briefing = {
      summary:
        parsed.summary ||
        "Prioritized your workspace based on upcoming deadlines and classes.",
      reason: parsed.reason || "AI Smart Priority",
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
