import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiUser } from "@/lib/session";
import {
  buildSmartTutorContext,
  callAiChat,
  callAiChatStream,
  getUserAiConfig,
} from "@/lib/ai";
import { AI_PROMPTS } from "@/lib/ai-prompts";
import { extractTextFromBuffer } from "@/lib/document-parser";
import { formatSearchResultsForPrompt, searchWebTool } from "@/lib/web-search";

export async function POST(request: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    let deadlineId = "";
    let mode = "answer";
    let customQuestions = "";
    let useWebSearch = true;
    let stream = false;
    let uploadedText = "";

    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const fd = await request.formData();
      deadlineId = String(fd.get("deadlineId") || "");
      mode = String(fd.get("mode") || "answer");
      customQuestions = String(fd.get("questions") || "");
      useWebSearch = fd.get("useWebSearch") !== "false";
      stream = fd.get("stream") === "true";
      const file = fd.get("file");
      if (file instanceof File && file.size > 0) {
        const buf = Buffer.from(await file.arrayBuffer());
        const extracted = await extractTextFromBuffer(buf, file.name, file.type);
        if (extracted) uploadedText = extracted;
      }
    } else {
      const body = await request.json();
      deadlineId = typeof body.deadlineId === "string" ? body.deadlineId : "";
      mode = typeof body.mode === "string" ? body.mode : "answer";
      customQuestions =
        typeof body.questions === "string" ? body.questions : "";
      useWebSearch = body.useWebSearch !== false;
      stream = body.stream === true;
    }

    if (!deadlineId) {
      return NextResponse.json(
        { error: "deadlineId is required" },
        { status: 400 },
      );
    }

    const deadline = await prisma.deadline.findFirst({
      where: { id: deadlineId, userId: user.id },
      include: { subject: true },
    });

    if (!deadline) {
      return NextResponse.json(
        { error: "Deadline not found" },
        { status: 404 },
      );
    }

    const effectiveQuestions = [
      uploadedText || "",
      customQuestions.trim() || deadline.questions || "",
    ]
      .filter(Boolean)
      .join("\n\n")
      .trim();

    if (uploadedText || customQuestions.trim()) {
      await prisma.deadline.update({
        where: { id: deadline.id },
        data: { questions: effectiveQuestions.slice(0, 20000) },
      });
    }

    const searchQuery = [
      deadline.subject?.name,
      deadline.title,
      effectiveQuestions.slice(0, 140) || deadline.description?.slice(0, 140),
    ]
      .filter(Boolean)
      .join(" ");

    const [{ context, openedNotes }, webResults] = await Promise.all([
      buildSmartTutorContext({
        userId: user.id,
        query: `${deadline.title} ${effectiveQuestions} ${deadline.description || ""}`,
        subjectId: deadline.subjectId,
        maxNoteChars: 7500,
        includeScheduleAndDeadlines: false,
      }),
      useWebSearch ? searchWebTool(searchQuery, 5) : Promise.resolve([]),
    ]);

    const webBlock =
      webResults.length > 0
        ? `\n--- VERIFIED WEB SEARCH SOURCES ---\n${formatSearchResultsForPrompt(webResults)}`
        : "";

    const aiRequest = AI_PROMPTS.deadlineHelper({
      mode,
      title: deadline.title,
      deadlineType: deadline.deadlineType,
      subjectName: deadline.subject?.name || "General",
      dueAtIso: deadline.dueAt.toISOString(),
      description: deadline.description || "None",
      effectiveQuestions,
      context,
      webBlock,
    });

    const sourcesPayload = {
      openedNotes,
      webSources: webResults,
    };

    if (stream) {
      const cfg = await getUserAiConfig(user.id);
      const encoder = new TextEncoder();
      const userId = user.id;
      const dlId = deadline.id;

      const sseStream = new ReadableStream({
        async start(controller) {
          const sendEvent = (event: string, data: unknown) => {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
            );
          };

          try {
            sendEvent("meta", {
              openedNotes,
              webSources: webResults,
              savedQuestions: effectiveQuestions,
              debugMode: cfg.debugMode,
              model: cfg.model,
            });

            const { content, model } = await callAiChatStream({
              userId,
              ...aiRequest,
              onThinking: (text) => sendEvent("thinking", { text }),
              onToken: (text) => sendEvent("token", { text }),
            });

            await prisma.deadline.update({
              where: { id: dlId },
              data: {
                aiAnswer: content,
                aiAnswerMode: mode,
                aiSources: JSON.stringify(sourcesPayload),
              },
            });

            sendEvent("done", {
              answer: content,
              mode,
              model,
              openedNotes,
              webSources: webResults,
              savedQuestions: effectiveQuestions,
            });
          } catch (err) {
            sendEvent("error", {
              error:
                err instanceof Error
                  ? err.message
                  : "Failed to generate assignment answer",
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

    await prisma.deadline.update({
      where: { id: deadline.id },
      data: {
        aiAnswer: content,
        aiAnswerMode: mode,
        aiSources: JSON.stringify(sourcesPayload),
      },
    });

    return NextResponse.json({
      answer: content,
      mode,
      model,
      openedNotes,
      webSources: webResults,
      savedQuestions: effectiveQuestions,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to generate assignment answer",
      },
      { status: 400 },
    );
  }
}
