import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/session";
import { extractTextFromBuffer } from "@/lib/document-parser";
import {
  callAiChat,
  callAiChatStream,
  extractJsonFromAi,
  getUserAiConfig,
  type AiMessageContent,
} from "@/lib/ai";
import { AI_PROMPTS } from "@/lib/ai-prompts";

export interface ParsedTimetableEntry {
  dayOfWeek: number; // 1=Mon ... 6=Sat, 0=Sun
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  title: string;
  eventType: "LECTURE" | "LAB" | "CUSTOM";
  location: string;
  description: string;
  recommended: boolean;
  tag: string;
}

export async function POST(request: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const contentType = request.headers.get("content-type") || "";
    let file: File | null = null;
    let rawText = "";
    let wantStream = false;
    let disableThinking = false;

    if (contentType.includes("multipart/form-data")) {
      const fd = await request.formData();
      const f = fd.get("file");
      if (f instanceof File && f.size > 0) file = f;
      const t = fd.get("text");
      if (typeof t === "string") rawText = t.trim();
      wantStream = fd.get("stream") === "true" || fd.get("stream") === "1";
      disableThinking = fd.get("fastMode") === "true" || fd.get("fastMode") === "1";
    } else {
      const json = await request.json();
      if (typeof json.text === "string") rawText = json.text.trim();
      wantStream = Boolean(json.stream);
      disableThinking = Boolean(json.fastMode);
    }

    if (!file && !rawText) {
      return NextResponse.json(
        { error: "Upload a timetable image/PDF or paste schedule text." },
        { status: 400 },
      );
    }

    const cfg = await getUserAiConfig(user.id);
    const noThinkHint = disableThinking ? "\n/no_think" : "";

    let userMessageContent: AiMessageContent;
    let mode: "vision" | "text" = "text";

    if (file && file.type.startsWith("image/")) {
      mode = "vision";
      const buffer = Buffer.from(await file.arrayBuffer());
      const base64 = buffer.toString("base64");
      const dataUrl = `data:${file.type || "image/png"};base64,${base64}`;
      userMessageContent = [
        {
          type: "text",
          text: `Parse this college timetable image completely into weekly class slots.${rawText ? `\nExtra user instructions: ${rawText}` : ""}${noThinkHint}`,
        },
        {
          type: "image_url",
          image_url: { url: dataUrl },
        },
      ];
    } else if (file) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const extracted = await extractTextFromBuffer(
        buffer,
        file.name,
        file.type,
      );
      if (!extracted) {
        return NextResponse.json(
          {
            error:
              "Could not extract text from that file. Upload an image screenshot (PNG/JPG) or paste the timetable text.",
          },
          { status: 400 },
        );
      }
      userMessageContent = `Parse this timetable text:\n${extracted.slice(0, 12000)}${rawText ? `\nExtra context: ${rawText}` : ""}${noThinkHint}`;
    } else {
      userMessageContent = `Parse this schedule text:\n${rawText.slice(0, 12000)}${noThinkHint}`;
    }

    const aiRequest = AI_PROMPTS.timetableExtract({
      userContent: userMessageContent,
      disableThinking,
    });

    console.info(
      `[Timetable AI] Starting extraction | model=${cfg.model} | mode=${mode} | timeout=${cfg.timeoutSeconds}s | fastMode=${disableThinking}`,
    );

    if (wantStream) {
      const encoder = new TextEncoder();
      const sendEvent = (
        controller: ReadableStreamDefaultController<Uint8Array>,
        event: string,
        data: unknown,
      ) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      const sseStream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const startedAt = Date.now();
          try {
            sendEvent(controller, "meta", {
              model: cfg.model,
              baseUrl: cfg.baseUrl,
              mode,
              timeoutSeconds: cfg.timeoutSeconds,
              fastMode: disableThinking,
              debugMode: cfg.debugMode,
              sampling: {
                temperature: aiRequest.temperature,
                top_p: aiRequest.topP,
                presence_penalty: aiRequest.presencePenalty,
                repeat_penalty: aiRequest.repeatPenalty,
              },
            });

            const { content, thinking, model } = await callAiChatStream({
              userId: user.id,
              ...aiRequest,
              onThinking: (delta) =>
                sendEvent(controller, "thinking", { text: delta }),
              onToken: (delta) =>
                sendEvent(controller, "token", { text: delta }),
            });

            const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
            console.info(
              `[Timetable AI] Finished in ${elapsed}s | model=${model} | thinkingChars=${thinking.length} | outputChars=${content.length}`,
            );

            const parsedOut = extractJsonFromAi<{
              entries?: ParsedTimetableEntry[];
            }>(content);
            const entries = sanitizeEntries(parsedOut.entries || []);

            sendEvent(controller, "done", {
              entries,
              model,
              elapsedSeconds: Number(elapsed),
            });
            controller.close();
          } catch (err) {
            const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
            const msg =
              err instanceof Error ? err.message : "Failed to parse timetable";
            console.error(`[Timetable AI] Failed after ${elapsed}s:`, msg);
            sendEvent(controller, "error", { error: msg });
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

    const startedAt = Date.now();
    const { content, model } = await callAiChat({
      userId: user.id,
      ...aiRequest,
    });
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.info(`[Timetable AI] Finished in ${elapsed}s | model=${model}`);

    const parsedOut = extractJsonFromAi<{ entries?: ParsedTimetableEntry[] }>(
      content,
    );

    return NextResponse.json({
      entries: sanitizeEntries(parsedOut.entries || []),
      model,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to parse timetable",
      },
      { status: 500 },
    );
  }
}

function sanitizeEntries(raw: ParsedTimetableEntry[]): ParsedTimetableEntry[] {
  return raw
    .filter((item) => item && item.title?.trim() && item.startTime && item.endTime)
    .map((item) => {
      const dow = Math.min(6, Math.max(0, Number(item.dayOfWeek) || 1));
      const cleanTime = (t: string, fallback: string) => {
        const m = String(t).trim().match(/^(\d{1,2}):(\d{2})/);
        if (!m) return fallback;
        return `${m[1].padStart(2, "0")}:${m[2]}`;
      };
      const eventType: ParsedTimetableEntry["eventType"] =
        item.eventType === "LAB" || item.eventType === "CUSTOM"
          ? item.eventType
          : "LECTURE";

      return {
        dayOfWeek: dow,
        startTime: cleanTime(item.startTime, "09:00"),
        endTime: cleanTime(item.endTime, "10:00"),
        title: String(item.title).trim().slice(0, 120),
        eventType,
        location: String(item.location || "").trim().slice(0, 80),
        description: String(item.description || "").trim().slice(0, 200),
        recommended: item.recommended !== false,
        tag: String(
          item.tag || (eventType === "LAB" ? "Lab Session" : "Core Class"),
        ).trim(),
      };
    })
    .sort(
      (a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime),
    );
}
