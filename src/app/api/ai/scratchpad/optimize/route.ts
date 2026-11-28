import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getApiUser } from "@/lib/session";
import { callAiChat, extractJsonFromAi } from "@/lib/ai";
import { AI_PROMPTS } from "@/lib/ai-prompts";

const optimizeSchema = z.object({
  title: z.string().max(200).optional(),
  content: z.string().min(1, "Enter some brainstorm notes to optimize").max(15000),
});

export async function POST(request: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = optimizeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid request" },
        { status: 400 },
      );
    }

    const { title, content } = parsed.data;
    const aiRequest = AI_PROMPTS.scratchpadOptimize({ title, content });

    const { content: aiRaw } = await callAiChat({
      userId: user.id,
      logFeature: "scratchpad_optimize",
      signal: request.signal,
      ...aiRequest,
    });

    const out = extractJsonFromAi<{ title?: string; content?: string }>(aiRaw);
    return NextResponse.json({
      title: (out.title || title || "").trim(),
      content: (out.content || content).trim(),
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to optimize note with AI",
      },
      { status: 500 },
    );
  }
}
