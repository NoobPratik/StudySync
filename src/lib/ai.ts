import "server-only";
import path from "path";
import fs from "fs/promises";
import http from "http";
import https from "https";
import { prisma } from "./prisma";
import { expandCalendarEvents } from "./calendar-recurrence";
import { extractTextFromBuffer } from "./document-parser";

const UPLOAD_ROOT = path.resolve(
  process.cwd(),
  process.env.UPLOAD_DIR || "./uploads",
);

export type AiMessageContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;

export interface ChatMessageInput {
  role: "system" | "user" | "assistant";
  content: AiMessageContent;
}

/**
 * Low-level HTTP/HTTPS JSON POST helper using Node's native http/https modules
 * so long-running local LLM requests bypass Node's hardcoded 300s undici headersTimeout.
 */
export function postAiHttpStream(options: {
  url: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}): Promise<{
  statusCode: number;
  statusMessage: string;
  headers: http.IncomingHttpHeaders;
  stream: http.IncomingMessage;
}> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(options.url);
    const isHttps = parsed.protocol === "https:";
    const transport = isHttps ? https : http;

    let settled = false;
    const req = transport.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: "POST",
        headers: {
          ...options.headers,
          "Content-Length": Buffer.byteLength(options.body),
        },
      },
      (res) => {
        if (settled) return;
        settled = true;
        resolve({
          statusCode: res.statusCode || 500,
          statusMessage: res.statusMessage || "",
          headers: res.headers,
          stream: res,
        });
      },
    );

    req.setTimeout(options.timeoutMs, () => {
      if (settled) return;
      settled = true;
      req.destroy(
        new Error(
          `AI provider timed out after ${Math.round(options.timeoutMs / 1000)}s`,
        ),
      );
    });

    req.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });

    req.write(options.body);
    req.end();
  });
}

export async function readIncomingText(
  stream: http.IncomingMessage,
): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export interface AiConfigData {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  fastModel: string | null;
  timeoutSeconds: number;
  customInstructions: string | null;
  temperature: number;
  debugMode: boolean;
}

export async function getUserAiConfig(userId: string): Promise<AiConfigData> {
  const cfg = await prisma.aiConfig.findUnique({ where: { userId } });
  return {
    baseUrl: (cfg?.baseUrl || "http://localhost:11434/v1").replace(/\/+$/, ""),
    apiKey: cfg?.apiKey || null,
    model: cfg?.model || "qwen3.5:9b",
    fastModel: cfg?.fastModel || null,
    timeoutSeconds: cfg?.timeoutSeconds ?? 300,
    customInstructions: cfg?.customInstructions || null,
    temperature: cfg?.temperature ?? 0.4,
    debugMode: cfg?.debugMode ?? false,
  };
}

export async function callAiChat(options: {
  userId: string;
  messages: ChatMessageInput[];
  tier?: "primary" | "fast";
  jsonMode?: boolean;
  temperature?: number;
  topP?: number;
  presencePenalty?: number;
  repeatPenalty?: number;
  maxTokens?: number;
}): Promise<{ content: string; model: string }> {
  const cfg = await getUserAiConfig(options.userId);
  const selectedModel =
    options.tier === "fast" && cfg.fastModel?.trim()
      ? cfg.fastModel.trim()
      : cfg.model;

  const endpoint = `${cfg.baseUrl}/chat/completions`;
  const timeoutMs = Math.max(30, Math.min(900, cfg.timeoutSeconds)) * 1000;
  const isOllama = /11434|ollama/i.test(cfg.baseUrl);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${cfg.apiKey || "ollama"}`,
  };

  const bodyObj: Record<string, unknown> = {
    model: selectedModel,
    messages: options.messages,
    temperature: options.temperature ?? cfg.temperature,
    ...(options.topP !== undefined ? { top_p: options.topP } : {}),
    ...(options.presencePenalty !== undefined
      ? { presence_penalty: options.presencePenalty }
      : {}),
    ...(isOllama && options.repeatPenalty !== undefined
      ? { repeat_penalty: options.repeatPenalty }
      : {}),
    ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
    ...(options.jsonMode ? { response_format: { type: "json_object" } } : {}),
  };

  let httpRes: Awaited<ReturnType<typeof postAiHttpStream>>;
  try {
    httpRes = await postAiHttpStream({
      url: endpoint,
      headers,
      body: JSON.stringify(bodyObj),
      timeoutMs,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Network error";
    throw new Error(
      `Could not reach AI provider at ${cfg.baseUrl} (${msg}). Check AI Settings or ensure Ollama is running.`,
    );
  }

  let resText = await readIncomingText(httpRes.stream);

  if (httpRes.statusCode === 400) {
    delete bodyObj.response_format;
    delete bodyObj.repeat_penalty;
    delete bodyObj.presence_penalty;
    httpRes = await postAiHttpStream({
      url: endpoint,
      headers,
      body: JSON.stringify(bodyObj),
      timeoutMs,
    });
    resText = await readIncomingText(httpRes.stream);
  }

  if (httpRes.statusCode < 200 || httpRes.statusCode >= 300) {
    throw new Error(
      `AI provider returned HTTP ${httpRes.statusCode}: ${resText.slice(0, 240) || httpRes.statusMessage}`,
    );
  }

  const data = JSON.parse(resText) as {
    choices?: Array<{ message?: { content?: string } }>;
    model?: string;
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("AI provider returned an empty response.");
  }

  return { content, model: data.model || selectedModel };
}

export async function callAiChatStream(options: {
  userId: string;
  messages: ChatMessageInput[];
  tier?: "primary" | "fast";
  temperature?: number;
  topP?: number;
  presencePenalty?: number;
  repeatPenalty?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  think?: boolean;
  maxThinkingChars?: number;
  onToken: (token: string) => void;
  onThinking?: (thinkingToken: string) => void;
}): Promise<{ content: string; thinking: string; model: string }> {
  const cfg = await getUserAiConfig(options.userId);
  const selectedModel =
    options.tier === "fast" && cfg.fastModel?.trim()
      ? cfg.fastModel.trim()
      : cfg.model;

  const endpoint = `${cfg.baseUrl}/chat/completions`;
  const timeoutMs = Math.max(30, Math.min(900, cfg.timeoutSeconds)) * 1000;
  const isOllama = /11434|ollama/i.test(cfg.baseUrl);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${cfg.apiKey || "ollama"}`,
  };

  // Detect true stuck repetition loops vs normal multi-row reasoning
  const detectThinkingAbort = (thinkBuf: string): string | null => {
    if (options.maxThinkingChars && thinkBuf.length > options.maxThinkingChars) {
      return `AI thinking exceeded ${options.maxThinkingChars} characters before emitting final output. Enable Fast Mode to skip extended thinking.`;
    }
    if (thinkBuf.length >= 2600) {
      const window = thinkBuf.slice(-3000);
      const needle = window.slice(-240).trim();
      if (needle.length >= 160) {
        const before = window.slice(0, -240);
        const h1 = before.indexOf(needle);
        if (h1 !== -1) {
          const h2 = before.indexOf(needle, h1 + 160);
          if (h2 !== -1) {
            return "Stopped early because the model repeated the exact same thinking block 3 times in a loop. Keep Fast Mode enabled or use Gemini 2.5 Flash.";
          }
        }
      }
    }
    return null;
  };

  // When Ollama + think=false (Fast Mode), use Ollama's native /api/chat endpoint
  // because /v1/chat/completions ignores "/no_think" on Qwen 3.5 whereas native think:false works reliably.
  if (isOllama && options.think === false) {
    const ollamaRoot = cfg.baseUrl.replace(/\/v1\/?$/i, "");
    const ollamaEndpoint = `${ollamaRoot}/api/chat`;
    const ollamaMessages = options.messages.map((m) => {
      if (typeof m.content === "string") {
        return { role: m.role, content: m.content };
      }
      const textParts: string[] = [];
      const images: string[] = [];
      for (const part of m.content) {
        if (part.type === "text") textParts.push(part.text);
        else if (part.type === "image_url") {
          const b64 = part.image_url.url.replace(/^data:[^;]+;base64,/i, "");
          images.push(b64);
        }
      }
      return {
        role: m.role,
        content: textParts.join("\n"),
        ...(images.length > 0 ? { images } : {}),
      };
    });

    const nativeBody = JSON.stringify({
      model: selectedModel,
      messages: ollamaMessages,
      stream: true,
      think: false,
      ...(options.jsonMode ? { format: "json" } : {}),
      options: {
        temperature: options.temperature ?? cfg.temperature,
        ...(options.topP !== undefined ? { top_p: options.topP } : {}),
        ...(options.repeatPenalty !== undefined
          ? { repeat_penalty: options.repeatPenalty }
          : {}),
        ...(options.presencePenalty !== undefined
          ? { presence_penalty: options.presencePenalty }
          : {}),
        ...(options.maxTokens ? { num_predict: options.maxTokens } : {}),
      },
    });

    let nativeRes: Awaited<ReturnType<typeof postAiHttpStream>> | null = null;
    try {
      nativeRes = await postAiHttpStream({
        url: ollamaEndpoint,
        headers: { "Content-Type": "application/json" },
        body: nativeBody,
        timeoutMs,
      });
    } catch {
      nativeRes = null;
    }

    if (nativeRes && nativeRes.statusCode >= 200 && nativeRes.statusCode < 300) {
      let nBuf = "";
      let nContent = "";
      let nThinking = "";
      let nModel = selectedModel;

      nativeRes.stream.setTimeout(timeoutMs, () => {
        nativeRes?.stream.destroy(
          new Error(`AI stream idle timeout after ${Math.round(timeoutMs / 1000)}s`),
        );
      });

      const parseNativeLine = (line: string) => {
        const clean = line.trim();
        if (!clean) return;
        try {
          const chunk = JSON.parse(clean) as {
            model?: string;
            error?: string;
            message?: { content?: string; thinking?: string };
          };
          if (chunk.error) throw new Error(chunk.error);
          if (chunk.model) nModel = chunk.model;
          if (chunk.message?.thinking) {
            nThinking += chunk.message.thinking;
            options.onThinking?.(chunk.message.thinking);
          }
          if (chunk.message?.content) {
            nContent += chunk.message.content;
            options.onToken(chunk.message.content);
          }
        } catch (err) {
          if (err instanceof Error && !err.message.includes("JSON")) throw err;
        }
      };

      for await (const chunk of nativeRes.stream) {
        nBuf += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
        const lines = nBuf.split(/\r?\n/);
        nBuf = lines.pop() || "";
        for (const l of lines) parseNativeLine(l);
      }
      if (nBuf.trim()) parseNativeLine(nBuf);

      const trimmed = nContent.trim();
      if (trimmed) {
        return { content: trimmed, thinking: nThinking.trim(), model: nModel };
      }
    } else if (nativeRes) {
      await readIncomingText(nativeRes.stream).catch(() => "");
    }
  }

  const bodyObj: Record<string, unknown> = {
    model: selectedModel,
    messages: options.messages,
    temperature: options.temperature ?? cfg.temperature,
    ...(options.topP !== undefined ? { top_p: options.topP } : {}),
    ...(options.presencePenalty !== undefined
      ? { presence_penalty: options.presencePenalty }
      : {}),
    ...(isOllama && options.repeatPenalty !== undefined
      ? { repeat_penalty: options.repeatPenalty }
      : {}),
    ...(options.think === false ? { reasoning_effort: "none" } : {}),
    stream: true,
    ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
    ...(options.jsonMode ? { response_format: { type: "json_object" } } : {}),
  };

  let httpRes: Awaited<ReturnType<typeof postAiHttpStream>>;
  try {
    httpRes = await postAiHttpStream({
      url: endpoint,
      headers,
      body: JSON.stringify(bodyObj),
      timeoutMs,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Network error";
    throw new Error(
      `Could not reach AI provider at ${cfg.baseUrl} (${msg}). Check AI Settings or ensure Ollama is running.`,
    );
  }

  if (httpRes.statusCode === 400) {
    await readIncomingText(httpRes.stream).catch(() => "");
    delete bodyObj.response_format;
    delete bodyObj.repeat_penalty;
    delete bodyObj.presence_penalty;
    delete bodyObj.reasoning_effort;
    httpRes = await postAiHttpStream({
      url: endpoint,
      headers,
      body: JSON.stringify(bodyObj),
      timeoutMs,
    });
  }

  if (httpRes.statusCode < 200 || httpRes.statusCode >= 300) {
    const errText = await readIncomingText(httpRes.stream).catch(() => "");
    throw new Error(
      `AI provider returned HTTP ${httpRes.statusCode}: ${errText.slice(0, 240) || httpRes.statusMessage}`,
    );
  }

  const contentType = String(httpRes.headers["content-type"] || "");
  if (contentType.includes("application/json")) {
    const rawJson = await readIncomingText(httpRes.stream);
    const data = JSON.parse(rawJson) as {
      choices?: Array<{
        message?: { content?: string; reasoning?: string; reasoning_content?: string };
      }>;
      model?: string;
    };
    const msg = data.choices?.[0]?.message;
    const think = msg?.reasoning || msg?.reasoning_content || "";
    const text = msg?.content?.trim() || "";
    if (think && options.onThinking) options.onThinking(think);
    if (!text) throw new Error("AI provider returned an empty response.");
    options.onToken(text);
    return { content: text, thinking: think, model: data.model || selectedModel };
  }

  let buffer = "";
  let fullContent = "";
  let fullThinking = "";
  let resolvedModel = selectedModel;
  let insideThinkTag = false;

  // Enforce per-chunk idle timeout on the incoming stream too
  httpRes.stream.setTimeout(timeoutMs, () => {
    httpRes.stream.destroy(
      new Error(
        `AI stream idle timeout after ${Math.round(timeoutMs / 1000)}s`,
      ),
    );
  });

  const processLine = (rawLine: string) => {
    const line = rawLine.trim();
    if (!line || !line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (payload === "[DONE]") return;

    try {
      const chunk = JSON.parse(payload) as {
        model?: string;
        choices?: Array<{
          delta?: {
            content?: string;
            reasoning?: string;
            reasoning_content?: string;
          };
          message?: {
            content?: string;
            reasoning?: string;
            reasoning_content?: string;
          };
        }>;
      };
      if (chunk.model) resolvedModel = chunk.model;
      const choice = chunk.choices?.[0];
      const reasonDelta =
        choice?.delta?.reasoning ??
        choice?.delta?.reasoning_content ??
        choice?.message?.reasoning ??
        choice?.message?.reasoning_content;
      if (reasonDelta) {
        fullThinking += reasonDelta;
        options.onThinking?.(reasonDelta);
      }

      const delta =
        choice?.delta?.content ?? choice?.message?.content;
      if (delta) {
        // Also route inline <think>...</think> tags if emitted inside content
        let remaining = delta;
        while (remaining.length > 0) {
          if (!insideThinkTag) {
            const openIdx = remaining.indexOf("<think>");
            if (openIdx === -1) {
              fullContent += remaining;
              options.onToken(remaining);
              remaining = "";
            } else {
              const before = remaining.slice(0, openIdx);
              if (before) {
                fullContent += before;
                options.onToken(before);
              }
              insideThinkTag = true;
              remaining = remaining.slice(openIdx + 7);
            }
          } else {
            const closeIdx = remaining.indexOf("</think>");
            if (closeIdx === -1) {
              fullThinking += remaining;
              options.onThinking?.(remaining);
              remaining = "";
            } else {
              const thinkPart = remaining.slice(0, closeIdx);
              if (thinkPart) {
                fullThinking += thinkPart;
                options.onThinking?.(thinkPart);
              }
              insideThinkTag = false;
              remaining = remaining.slice(closeIdx + 8);
            }
          }
        }
      }
    } catch {
      // Ignore partial or keepalive lines
    }
  };

  for await (const chunk of httpRes.stream) {
    buffer += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const rawLine of lines) processLine(rawLine);
    if (!fullContent) {
      const abortReason = detectThinkingAbort(fullThinking);
      if (abortReason) {
        httpRes.stream.destroy();
        throw new Error(abortReason);
      }
    }
  }
  if (buffer.trim()) processLine(buffer);

  const trimmed = fullContent.trim();
  if (!trimmed) {
    throw new Error(
      fullThinking.trim()
        ? "AI spent its entire response thinking without emitting final output. Try a faster model (e.g. Gemini 2.5 Flash) or increase max timeout."
        : "AI provider stream ended with an empty response.",
    );
  }

  return {
    content: trimmed,
    thinking: fullThinking.trim(),
    model: resolvedModel,
  };
}

export function extractJsonFromAi<T>(raw: string): T {
  const withoutThink = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fenced = withoutThink.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : withoutThink).trim();
  try {
    return JSON.parse(candidate) as T;
  } catch {
    const firstBrace = candidate.indexOf("{");
    const lastBrace = candidate.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(candidate.slice(firstBrace, lastBrace + 1)) as T;
    }
    throw new Error("AI did not return valid JSON.");
  }
}

async function ensureNoteText(note: {
  id: string;
  fileName: string;
  fileType: string;
  filePath: string;
  extractedText: string | null;
}): Promise<string | null> {
  if (note.extractedText) return note.extractedText;
  const fullPath = path.resolve(UPLOAD_ROOT, note.filePath);
  if (!fullPath.startsWith(UPLOAD_ROOT)) return null;
  const buffer = await fs.readFile(fullPath).catch(() => null);
  if (!buffer) return null;
  const text = await extractTextFromBuffer(buffer, note.fileName, note.fileType);
  if (text) {
    await prisma.note
      .update({ where: { id: note.id }, data: { extractedText: text } })
      .catch(() => {});
  }
  return text;
}

function tokenizeQuery(q: string): string[] {
  const stop = new Set([
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "from",
    "what",
    "when",
    "where",
    "which",
    "how",
    "why",
    "can",
    "you",
    "help",
    "explain",
    "about",
    "into",
    "notes",
    "note",
    "module",
    "subject",
    "please",
    "tell",
    "give",
  ]);
  return q
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !stop.has(w));
}

export async function buildSmartTutorContext(options: {
  userId: string;
  query: string;
  subjectId?: string | null;
  maxNoteChars?: number;
  includeScheduleAndDeadlines?: boolean;
}): Promise<{
  context: string;
  openedNotes: Array<{
    id: string;
    title: string;
    fileName: string;
    subjectName: string | null;
  }>;
}> {
  const {
    userId,
    query,
    subjectId,
    maxNoteChars = 7000,
    includeScheduleAndDeadlines = true,
  } = options;
  const now = new Date();
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const tokens = tokenizeQuery(query);

  const [user, profile, subjects, deadlines, rawEvents, allNotes, aiConfig] =
    await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { name: true },
      }),
      prisma.profile.findUnique({ where: { userId } }),
      prisma.subject.findMany({
        where: { userId },
        include: {
          modules: {
            orderBy: { order: "asc" },
            include: { topics: { orderBy: { order: "asc" } } },
          },
        },
      }),
      prisma.deadline.findMany({
        where: { userId, status: { not: "COMPLETED" } },
        include: { subject: { select: { name: true, code: true } } },
        orderBy: { dueAt: "asc" },
        take: 10,
      }),
      prisma.calendarEvent.findMany({ where: { userId } }),
      prisma.note.findMany({
        where: { userId },
        include: {
          subject: { select: { id: true, name: true, code: true } },
        },
        orderBy: { uploadedAt: "desc" },
      }),
      getUserAiConfig(userId),
    ]);

  // Score subjects automatically against user query
  const scoredSubjects = subjects.map((s) => {
    let score = subjectId && s.id === subjectId ? 100 : 0;
    const subLower = `${s.name} ${s.code || ""}`.toLowerCase();
    for (const tok of tokens) {
      if (subLower.includes(tok)) score += 12;
    }
    for (const m of s.modules) {
      const mLower = m.name.toLowerCase();
      for (const tok of tokens) {
        if (mLower.includes(tok)) score += 6;
      }
      for (const t of m.topics) {
        const tLower = t.name.toLowerCase();
        for (const tok of tokens) {
          if (tLower.includes(tok)) score += 4;
        }
      }
    }
    return { subject: s, score };
  });

  scoredSubjects.sort((a, b) => b.score - a.score);
  const matchedSubjectIds = new Set(
    scoredSubjects.filter((x) => x.score > 0).map((x) => x.subject.id),
  );

  // Score and open the most relevant notes automatically (keeps prompt fast for 8GB VRAM!)
  const scoredNotes = allNotes.map((n) => {
    let score = 0;
    if (n.subjectId && matchedSubjectIds.has(n.subjectId)) score += 15;
    if (subjectId && n.subjectId === subjectId) score += 20;
    const meta = `${n.title} ${n.fileName} ${n.subject?.name || ""}`.toLowerCase();
    const contentLower = (n.extractedText || "").slice(0, 4000).toLowerCase();
    for (const tok of tokens) {
      if (meta.includes(tok)) score += 10;
      if (contentLower.includes(tok)) score += 3;
    }
    return { note: n, score };
  });

  scoredNotes.sort((a, b) => b.score - a.score);
  const topNotes = scoredNotes
    .filter((x, idx) => x.score > 0 || (matchedSubjectIds.size === 0 && idx < 2))
    .slice(0, 3)
    .map((x) => x.note);

  const openedNotes: Array<{
    id: string;
    title: string;
    fileName: string;
    subjectName: string | null;
  }> = [];

  const noteSnippets: string[] = [];
  let usedChars = 0;
  for (const n of topNotes) {
    if (usedChars >= maxNoteChars) break;
    const text = await ensureNoteText(n);
    openedNotes.push({
      id: n.id,
      title: n.title,
      fileName: n.fileName,
      subjectName: n.subject?.name || null,
    });
    if (text) {
      // Find best window around matching query tokens if note is long
      let slice = text.slice(0, 2500);
      if (text.length > 2500 && tokens.length > 0) {
        const lower = text.toLowerCase();
        for (const tok of tokens) {
          const hit = lower.indexOf(tok);
          if (hit !== -1) {
            const start = Math.max(0, hit - 400);
            slice = text.slice(start, start + 2500);
            break;
          }
        }
      }
      const budget = Math.min(slice.length, maxNoteChars - usedChars);
      noteSnippets.push(
        `[File: ${n.title} (${n.fileName})${n.subject ? ` | Subject: ${n.subject.name}` : ""}]\n${slice.slice(0, budget)}`,
      );
      usedChars += budget;
    }
  }

  const upcomingEvents = expandCalendarEvents(rawEvents, now, in7Days).slice(
    0,
    8,
  );

  const lines: string[] = [];
  lines.push(`Current Date: ${now.toISOString().slice(0, 10)}`);
  lines.push(
    `Student: ${user?.name || "Student"}${profile?.program ? ` | ${profile.program}` : ""}${profile?.branch ? ` ${profile.branch}` : ""}${profile?.semester ? ` | Sem ${profile.semester}` : ""}`,
  );
  if (profile?.semesterEndDate) {
    const daysLeft = Math.max(
      0,
      Math.ceil(
        (new Date(profile.semesterEndDate).getTime() - now.getTime()) /
          (1000 * 60 * 60 * 24),
      ),
    );
    lines.push(`Target Exam Date: ${profile.semesterEndDate.toISOString().slice(0, 10)} (${daysLeft} days left)`);
  }
  if (aiConfig.customInstructions) {
    lines.push(`Student Instructions: ${aiConfig.customInstructions}`);
  }

  if (subjects.length > 0) {
    lines.push("\n--- SYLLABUS & PROGRESS ---");
    for (const { subject: s, score } of scoredSubjects) {
      const total = s.modules.reduce((a, m) => a + m.topics.length, 0);
      const done = s.modules.reduce(
        (a, m) => a + m.topics.filter((t) => t.isCompleted).length,
        0,
      );
      lines.push(
        `Subject: ${s.name}${s.code ? ` (${s.code})` : ""} — ${done}/${total} topics covered`,
      );
      // Only expand detailed module/topic lists for matched subjects (or when <= 3 subjects) to keep local context lean
      if (score > 0 || subjects.length <= 3) {
        for (const m of s.modules) {
          const cov = m.topics.filter((t) => t.isCompleted).map((t) => t.name);
          const rem = m.topics.filter((t) => !t.isCompleted).map((t) => t.name);
          lines.push(
            `  • ${m.name}: Covered=[${cov.join("; ") || "none"}] | Remaining=[${rem.join("; ") || "none"}]`,
          );
        }
      }
    }
  }

  if (allNotes.length > 0) {
    lines.push(
      `\nAvailable Uploaded Files: ${allNotes.map((n) => `${n.title}${n.subject ? ` (${n.subject.name})` : ""}`).join(", ")}`,
    );
  }

  if (includeScheduleAndDeadlines && deadlines.length > 0) {
    lines.push("\n--- UPCOMING DEADLINES ---");
    for (const d of deadlines.slice(0, 6)) {
      lines.push(
        `- [${d.priority}] ${d.title} (${d.deadlineType}) due ${d.dueAt.toISOString().slice(0, 16)}${d.subject ? ` | ${d.subject.name}` : ""}`,
      );
    }
  }

  if (includeScheduleAndDeadlines && upcomingEvents.length > 0) {
    lines.push("\n--- NEXT SCHEDULED CLASSES/EVENTS ---");
    for (const ev of upcomingEvents.slice(0, 6)) {
      lines.push(
        `- ${ev.startAt.slice(0, 16)} | ${ev.title} (${ev.eventType})${ev.location ? ` @ ${ev.location}` : ""}`,
      );
    }
  }

  if (noteSnippets.length > 0) {
    lines.push("\n--- OPENED NOTE CONTENTS ---\n" + noteSnippets.join("\n\n"));
  }

  return { context: lines.join("\n"), openedNotes };
}

export async function buildStudentContext(
  userId: string,
  subjectId?: string | null,
): Promise<string> {
  const { context } = await buildSmartTutorContext({
    userId,
    query: "",
    subjectId,
    maxNoteChars: 5000,
  });
  return context;
}
