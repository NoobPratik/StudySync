import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/session";
import {
  buildStudentContext,
  callAiChat,
  callAiChatStream,
  getUserAiConfig,
} from "@/lib/ai";
import { AI_PROMPTS } from "@/lib/ai-prompts";

export async function POST(request: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const wantStream = Boolean(body.stream);
    const context = await buildStudentContext(user.id);
    const aiRequest = AI_PROMPTS.studyPlan(context);

    if (wantStream) {
      const cfg = await getUserAiConfig(user.id);
      const encoder = new TextEncoder();
      const sseStream = new ReadableStream({
        async start(controller) {
          const sendEvent = (event: string, data: unknown) => {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
            );
          };

          try {
            sendEvent("meta", { debugMode: cfg.debugMode, model: cfg.model });
            const { content, model } = await callAiChatStream({
              userId: user.id,
              ...aiRequest,
              onThinking: (text) => sendEvent("thinking", { text }),
              onToken: (text) => sendEvent("token", { text }),
            });
            sendEvent("done", { plan: content, model });
          } catch (err) {
            sendEvent("error", {
              error:
                err instanceof Error
                  ? err.message
                  : "Failed to generate study plan",
            });
          } finally {
            controller.close();
          }
        },
      });

      return new Response(sseStream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }

    const { content, model } = await callAiChat({
      userId: user.id,
      ...aiRequest,
    });

    return NextResponse.json({ plan: content, model });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to generate study plan",
      },
      { status: 400 },
    );
  }
}
