import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getApiUser } from "@/lib/session";
import {
  buildCourseStudyContext,
  callAiChat,
  callAiChatStream,
  formatMessagesForLog,
  getUserAiConfig,
} from "@/lib/ai";
import { AI_PROMPTS } from "@/lib/ai-prompts";
import { formatSearchResultsForPrompt, searchWebTool } from "@/lib/web-search";

const THREAD_INCLUDE = {
  subject: { select: { id: true, name: true, code: true, color: true } },
  module: {
    select: {
      id: true,
      name: true,
      topics: {
        orderBy: { order: "asc" as const },
        select: { id: true, name: true, isCompleted: true, order: true },
      },
    },
  },
  topic: { select: { id: true, name: true, isCompleted: true, order: true } },
  messages: { orderBy: { createdAt: "asc" as const } },
};

export async function GET() {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const threads = await prisma.chatThread.findMany({
    where: { userId: user.id },
    include: THREAD_INCLUDE,
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({ threads });
}

const sendMessageSchema = z.object({
  threadId: z.string().optional().nullable(),
  subjectId: z.string().optional().nullable(),
  moduleId: z.string().optional().nullable(),
  topicId: z.string().optional().nullable(),
  action: z
    .enum(["chat", "explain", "quiz", "mock", "regenerate"])
    .optional()
    .default("chat"),
  message: z.string().max(4000).optional().default(""),
  useWebSearch: z.boolean().optional().default(false),
  think: z.boolean().optional(),
  stream: z.boolean().optional().default(false),
});

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
        { error: parsed.error.issues[0]?.message || "Invalid request" },
        { status: 400 },
      );
    }

    const {
      threadId,
      subjectId: reqSubjectId,
      moduleId: reqModuleId,
      topicId: reqTopicId,
      action,
      message: rawMessage,
      useWebSearch,
      think,
      stream,
    } = parsed.data;

    let thread = threadId
      ? await prisma.chatThread.findFirst({
          where: { id: threadId, userId: user.id },
          include: { messages: { orderBy: { createdAt: "asc" }, take: 12 } },
        })
      : null;

    const effectiveSubjectId = reqSubjectId ?? thread?.subjectId ?? null;
    const effectiveModuleId = reqModuleId ?? thread?.moduleId ?? null;
    const effectiveTopicId = reqTopicId ?? thread?.topicId ?? null;

    const queryText = rawMessage.trim();
    if (action === "chat" && !queryText) {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 },
      );
    }

    const studyCtx = await buildCourseStudyContext({
      userId: user.id,
      query: queryText || "explain topic",
      subjectId: effectiveSubjectId,
      moduleId: effectiveModuleId,
      topicId: effectiveTopicId,
      maxMaterialChars: 6200,
    });

    if ((action === "explain" || action === "quiz" || action === "mock" || action === "regenerate") && !studyCtx.topic) {
      return NextResponse.json(
        { error: "Select a valid topic to study first." },
        { status: 400 },
      );
    }

    // Build user display prompt and AI request payload
    let userDisplayMessage = queryText;
    let aiRequest: ReturnType<typeof AI_PROMPTS.courseChat>;
    let webSources: Array<{ title: string; url: string; snippet: string }> = [];

    const historyMessages = (thread?.messages || []).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    if (
      (action === "explain" || action === "regenerate") &&
      studyCtx.topic &&
      studyCtx.module &&
      studyCtx.subject
    ) {
      userDisplayMessage =
        action === "regenerate"
          ? `Re-explain: ${studyCtx.topic.name}`
          : `Explain: ${studyCtx.topic.name}`;

      aiRequest = AI_PROMPTS.explainTopic({
        subjectName: studyCtx.subject.name,
        moduleName: studyCtx.module.name,
        topicName: studyCtx.topic.name,
        topicIndex: studyCtx.topic.index,
        totalTopics: studyCtx.topic.total,
        moduleRoadmap: studyCtx.moduleRoadmap,
        materialExcerpts: studyCtx.materialExcerpts,
        regenerateHint: action === "regenerate",
        think,
      });
    } else if (
      action === "quiz" &&
      studyCtx.topic &&
      studyCtx.module &&
      studyCtx.subject
    ) {
      userDisplayMessage = `Quiz me on: ${studyCtx.topic.name}`;
      aiRequest = AI_PROMPTS.quizTopic({
        subjectName: studyCtx.subject.name,
        moduleName: studyCtx.module.name,
        topicName: studyCtx.topic.name,
        materialExcerpts: studyCtx.materialExcerpts,
        history: historyMessages,
        think,
      });
    } else if (
      action === "mock" &&
      studyCtx.topic &&
      studyCtx.module &&
      studyCtx.subject
    ) {
      userDisplayMessage = `Mock exam questions: ${studyCtx.topic.name}`;
      aiRequest = AI_PROMPTS.mockTopicQuestions({
        subjectName: studyCtx.subject.name,
        moduleName: studyCtx.module.name,
        topicName: studyCtx.topic.name,
        materialExcerpts: studyCtx.materialExcerpts,
        history: historyMessages,
        think,
      });
    } else {
      let webBlock = "";
      if (useWebSearch) {
        const searchQuery = [
          studyCtx.subject?.name,
          studyCtx.topic?.name,
          queryText,
        ]
          .filter(Boolean)
          .join(" ");
        webSources = await searchWebTool(searchQuery, 4);
        if (webSources.length > 0) {
          webBlock = `\n--- WEB SEARCH RESULTS ---\n${formatSearchResultsForPrompt(webSources)}`;
        }
      }

      aiRequest = AI_PROMPTS.courseChat({
        subjectLabel: studyCtx.subject
          ? `${studyCtx.subject.name}${studyCtx.subject.code ? ` (${studyCtx.subject.code})` : ""}`
          : "General Course Material",
        moduleLabel: studyCtx.module?.name || null,
        topicLabel: studyCtx.topic?.name || null,
        syllabusContext: studyCtx.syllabusContext,
        materialExcerpts: studyCtx.materialExcerpts,
        webBlock,
        history: historyMessages,
        message: queryText,
        think,
      });
    }

    const threadTitle = studyCtx.module && studyCtx.subject
      ? `${studyCtx.subject.code || studyCtx.subject.name} — ${studyCtx.module.name}`.slice(0, 72)
      : studyCtx.subject
        ? `${studyCtx.subject.name}: ${userDisplayMessage}`.slice(0, 72)
        : userDisplayMessage.slice(0, 60);

    if (!thread) {
      thread = await prisma.chatThread.create({
        data: {
          userId: user.id,
          subjectId: studyCtx.subject?.id || null,
          moduleId: studyCtx.module?.id || null,
          topicId: studyCtx.topic?.id || null,
          mode: studyCtx.topic ? "TOPIC_STUDY" : "COURSE",
          title: threadTitle,
        },
        include: { messages: true },
      });
    } else {
      await prisma.chatThread.update({
        where: { id: thread.id },
        data: {
          subjectId: studyCtx.subject?.id ?? thread.subjectId,
          moduleId: studyCtx.module?.id ?? thread.moduleId,
          topicId: studyCtx.topic?.id ?? thread.topicId,
          mode: studyCtx.topic ? "TOPIC_STUDY" : thread.mode,
        },
      });
    }

    const baseMetadata = {
      action,
      subjectId: studyCtx.subject?.id || null,
      subjectName: studyCtx.subject?.name || null,
      moduleId: studyCtx.module?.id || null,
      moduleName: studyCtx.module?.name || null,
      topicId: studyCtx.topic?.id || null,
      topicName: studyCtx.topic?.name || null,
      openedNotes: studyCtx.openedNotes,
      webSources,
    };

    if (stream) {
      const cfg = await getUserAiConfig(user.id);
      const encoder = new TextEncoder();
      const activeThreadId = thread.id;
      const userId = user.id;

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
              subject: studyCtx.subject,
              module: studyCtx.module,
              topic: studyCtx.topic,
              nextTopic: studyCtx.nextTopic,
              prevTopic: studyCtx.prevTopic,
              openedNotes: studyCtx.openedNotes,
              webSources,
              debugMode: cfg.debugMode,
              model: cfg.model,
              promptPreview: cfg.debugMode
                ? formatMessagesForLog(aiRequest.messages)
                : undefined,
            });

            const { content: reply, model } = await callAiChatStream({
              userId,
              logFeature: `chat_${action}`,
              signal: request.signal,
              ...aiRequest,
              onThinking: (text) => sendEvent("thinking", { text }),
              onToken: (text) => sendEvent("token", { text }),
            });

            const msgMeta = JSON.stringify({ ...baseMetadata, model });

            await prisma.chatMessage.createMany({
              data: [
                {
                  threadId: activeThreadId,
                  role: "user",
                  content: userDisplayMessage,
                  metadata: JSON.stringify({
                    action,
                    topicId: studyCtx.topic?.id || null,
                    topicName: studyCtx.topic?.name || null,
                  }),
                },
                {
                  threadId: activeThreadId,
                  role: "assistant",
                  content: reply,
                  metadata: msgMeta,
                },
              ],
            });

            const updatedThread = await prisma.chatThread.update({
              where: { id: activeThreadId },
              data: { updatedAt: new Date() },
              include: THREAD_INCLUDE,
            });

            sendEvent("done", {
              thread: updatedThread,
              model,
              openedNotes: studyCtx.openedNotes,
              webSources,
              topic: studyCtx.topic,
              nextTopic: studyCtx.nextTopic,
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
      logFeature: `chat_${action}`,
      ...aiRequest,
    });

    await prisma.chatMessage.createMany({
      data: [
        {
          threadId: thread.id,
          role: "user",
          content: userDisplayMessage,
          metadata: JSON.stringify({
            action,
            topicId: studyCtx.topic?.id || null,
            topicName: studyCtx.topic?.name || null,
          }),
        },
        {
          threadId: thread.id,
          role: "assistant",
          content: reply,
          metadata: JSON.stringify({ ...baseMetadata, model }),
        },
      ],
    });

    const updatedThread = await prisma.chatThread.update({
      where: { id: thread.id },
      data: { updatedAt: new Date() },
      include: THREAD_INCLUDE,
    });

    return NextResponse.json({
      thread: updatedThread,
      model,
      openedNotes: studyCtx.openedNotes,
      webSources,
      topic: studyCtx.topic,
      nextTopic: studyCtx.nextTopic,
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

const patchThreadSchema = z.object({
  threadId: z.string().min(1),
  subjectId: z.string().nullable().optional(),
  moduleId: z.string().nullable().optional(),
  topicId: z.string().nullable().optional(),
});

export async function PATCH(request: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = patchThreadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const existing = await prisma.chatThread.findFirst({
      where: { id: parsed.data.threadId, userId: user.id },
    });
    if (!existing) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    const updated = await prisma.chatThread.update({
      where: { id: existing.id },
      data: {
        ...(parsed.data.subjectId !== undefined
          ? { subjectId: parsed.data.subjectId }
          : {}),
        ...(parsed.data.moduleId !== undefined
          ? { moduleId: parsed.data.moduleId }
          : {}),
        ...(parsed.data.topicId !== undefined
          ? { topicId: parsed.data.topicId }
          : {}),
      },
      include: THREAD_INCLUDE,
    });

    return NextResponse.json({ thread: updated });
  } catch {
    return NextResponse.json(
      { error: "Failed to update thread scope" },
      { status: 500 },
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
