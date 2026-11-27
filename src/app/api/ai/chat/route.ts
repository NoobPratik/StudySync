import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getApiUser } from "@/lib/session";
import {
  buildSmartTutorContext,
  callAiChat,
  callAiChatStream,
  getUserAiConfig,
} from "@/lib/ai";
import { AI_PROMPTS } from "@/lib/ai-prompts";
import { formatSearchResultsForPrompt, searchWebTool } from "@/lib/web-search";

export async function GET() {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const threads = await prisma.chatThread.findMany({
    where: { userId: user.id },
    include: {
      subject: { select: { id: true, name: true, code: true, color: true } },
      messages: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({ threads });
}

const sendMessageSchema = z.object({
  threadId: z.string().optional().nullable(),
  message: z.string().min(1, "Message is required").max(4000),
  useWebSearch: z.boolean().optional().default(false),
  stream: z.boolean().optional().default(false),
});

const SCHEDULE_OR_DEADLINE_RE =
  /\b(deadline|deadlines|due|assignment|schedule|timetable|lecture|lectures|class|classes|calendar|today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|plan|study next|upcoming)\b/i;

export async function POST(request: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = sendMessageSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid message" },
        { status: 400 },
      );
    }

    const { threadId, message, useWebSearch, stream } = parsed.data;

    let thread = threadId
      ? await prisma.chatThread.findFirst({
          where: { id: threadId, userId: user.id },
          include: { messages: { orderBy: { createdAt: "asc" }, take: 10 } },
        })
      : null;

    if (!thread) {
      thread = await prisma.chatThread.create({
        data: {
          userId: user.id,
          title: message.trim().slice(0, 60),
        },
        include: { messages: true },
      });
    }

    const wantsScheduleContext = SCHEDULE_OR_DEADLINE_RE.test(message);

    const { context, openedNotes } = await buildSmartTutorContext({
      userId: user.id,
      query: message,
      maxNoteChars: 7500,
      includeScheduleAndDeadlines: wantsScheduleContext,
    });

    let webSources: Array<{ title: string; url: string; snippet: string }> = [];
    let webBlock = "";
    if (useWebSearch) {
      webSources = await searchWebTool(message, 4);
      if (webSources.length > 0) {
        webBlock = `\n--- WEB SEARCH RESULTS ---\n${formatSearchResultsForPrompt(webSources)}`;
      }
    }

    const historyMessages = thread.messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const aiRequest = AI_PROMPTS.chatTutor({
      context,
      webBlock,
      history: historyMessages,
      message,
    });

    if (stream) {
      const cfg = await getUserAiConfig(user.id);
      const encoder = new TextEncoder();
      const activeThreadId = thread.id;
      const userId = user.id;
      const userMsgText = message.trim();

      const sseStream = new ReadableStream({
        async start(controller) {
          const sendEvent = (event: string, data: unknown) => {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
            );
          };

          try {
            sendEvent("meta", {
              threadId: activeThreadId,
              openedNotes,
              webSources,
              debugMode: cfg.debugMode,
              model: cfg.model,
            });

            const { content: reply, model } = await callAiChatStream({
              userId,
              ...aiRequest,
              onThinking: (text) => sendEvent("thinking", { text }),
              onToken: (text) => sendEvent("token", { text }),
            });

            await prisma.chatMessage.createMany({
              data: [
                { threadId: activeThreadId, role: "user", content: userMsgText },
                { threadId: activeThreadId, role: "assistant", content: reply },
              ],
            });

            const updatedThread = await prisma.chatThread.update({
              where: { id: activeThreadId },
              data: { updatedAt: new Date() },
              include: {
                subject: {
                  select: { id: true, name: true, code: true, color: true },
                },
                messages: { orderBy: { createdAt: "asc" } },
              },
            });

            sendEvent("done", {
              thread: updatedThread,
              model,
              openedNotes,
              webSources,
            });
          } catch (err) {
            sendEvent("error", {
              error:
                err instanceof Error ? err.message : "AI stream request failed",
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

    const { content: reply, model } = await callAiChat({
      userId: user.id,
      ...aiRequest,
    });

    await prisma.chatMessage.createMany({
      data: [
        { threadId: thread.id, role: "user", content: message.trim() },
        { threadId: thread.id, role: "assistant", content: reply },
      ],
    });

    const updatedThread = await prisma.chatThread.update({
      where: { id: thread.id },
      data: { updatedAt: new Date() },
      include: {
        subject: { select: { id: true, name: true, code: true, color: true } },
        messages: { orderBy: { createdAt: "asc" } },
      },
    });

    return NextResponse.json({
      thread: updatedThread,
      model,
      openedNotes,
      webSources,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "AI chat request failed",
      },
      { status: 400 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const threadId = new URL(request.url).searchParams.get("threadId");
  if (!threadId) {
    return NextResponse.json({ error: "threadId is required" }, { status: 400 });
  }

  await prisma.chatThread.deleteMany({
    where: { id: threadId, userId: user.id },
  });

  return NextResponse.json({ success: true });
}
