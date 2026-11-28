import "server-only";
import path from "path";
import fs from "fs/promises";
import http from "http";
import https from "https";
import { prisma } from "./prisma";
import { expandCalendarEvents } from "./calendar-recurrence";
import { resolveTimeZone } from "./timezone";
import { extractTextFromBuffer } from "./document-parser";
import { AI_PROMPTS } from "./ai-prompts";

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
  signal?: AbortSignal;
}): Promise<{
  statusCode: number;
  statusMessage: string;
  headers: http.IncomingHttpHeaders;
  stream: http.IncomingMessage;
}> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new Error("Request stopped by user"));
      return;
    }

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

    const onAbort = () => {
      const abortErr = new Error("Request stopped by user");
      if (!settled) {
        settled = true;
        req.destroy(abortErr);
        reject(abortErr);
      } else {
        req.destroy(abortErr);
      }
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    req.setTimeout(options.timeoutMs, () => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", onAbort);
      req.destroy(
        new Error(
          `AI provider timed out after ${Math.round(options.timeoutMs / 1000)}s`,
        ),
      );
    });

    req.on("error", (err) => {
      options.signal?.removeEventListener("abort", onAbort);
      if (settled) return;
      settled = true;
      reject(err);
    });

    req.on("close", () => {
      options.signal?.removeEventListener("abort", onAbort);
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

export function formatMessagesForLog(messages: ChatMessageInput[]): string {
  return messages
    .map((m) => {
      const text =
        typeof m.content === "string"
          ? m.content
          : m.content
              .map((p) => (p.type === "text" ? p.text : "[image]"))
              .join("\n");
      return `=== ${m.role.toUpperCase()} ===\n${text}`;
    })
    .join("\n\n");
}

export async function recordAiLog(entry: {
  userId: string;
  feature: string;
  model: string;
  durationMs: number;
  status?: "SUCCESS" | "ERROR" | "STOPPED";
  inputPrompt: string;
  thinking?: string | null;
  rawOutput?: string | null;
  parsedOutput?: string | null;
  errorMessage?: string | null;
}): Promise<string | null> {
  try {
    const created = await prisma.aiLog.create({
      data: {
        userId: entry.userId,
        feature: entry.feature,
        model: entry.model,
        durationMs: Math.max(0, Math.round(entry.durationMs)),
        status: entry.status || "SUCCESS",
        inputPrompt: entry.inputPrompt.slice(0, 120000),
        thinking: entry.thinking ? entry.thinking.slice(0, 80000) : null,
        rawOutput: entry.rawOutput ? entry.rawOutput.slice(0, 80000) : null,
        parsedOutput: entry.parsedOutput
          ? entry.parsedOutput.slice(0, 40000)
          : null,
        errorMessage: entry.errorMessage
          ? entry.errorMessage.slice(0, 2000)
          : null,
      },
      select: { id: true },
    });

    // Keep latest 50 logs per user so SQLite stays lean
    const oldLogs = await prisma.aiLog.findMany({
      where: { userId: entry.userId },
      orderBy: { createdAt: "desc" },
      skip: 50,
      select: { id: true },
    });
    if (oldLogs.length > 0) {
      await prisma.aiLog.deleteMany({
        where: { id: { in: oldLogs.map((l) => l.id) } },
      });
    }
    return created.id;
  } catch {
    return null;
  }
}

function splitInlineThinkTags(raw: string): {
  cleanContent: string;
  extractedThinking: string;
} {
  const thinkParts: string[] = [];
  const clean = raw
    .replace(/<think>([\s\S]*?)<\/think>/gi, (_, inner) => {
      if (inner && String(inner).trim()) thinkParts.push(String(inner).trim());
      return "";
    })
    .trim();
  return {
    cleanContent: clean,
    extractedThinking: thinkParts.join("\n\n"),
  };
}

export async function callAiChat(options: {
  userId: string;
  messages: ChatMessageInput[];
  tier?: "primary" | "fast";
  jsonMode?: boolean;
  think?: boolean;
  temperature?: number;
  topP?: number;
  presencePenalty?: number;
  repeatPenalty?: number;
  maxTokens?: number;
  logFeature?: string;
  skipLog?: boolean;
  signal?: AbortSignal;
}): Promise<{ content: string; thinking: string; model: string }> {
  const startedAt = Date.now();
  const cfg = await getUserAiConfig(options.userId);
  const selectedModel =
    options.tier === "fast" && cfg.fastModel?.trim()
      ? cfg.fastModel.trim()
      : cfg.model;

  const endpoint = `${cfg.baseUrl}/chat/completions`;
  const timeoutMs = Math.max(30, Math.min(900, cfg.timeoutSeconds)) * 1000;
  const isOllama = /11434|ollama/i.test(cfg.baseUrl);
  const promptText = formatMessagesForLog(options.messages);

  const saveLog = async (res: {
    status: "SUCCESS" | "ERROR";
    model: string;
    thinking?: string;
    rawOutput?: string;
    errorMessage?: string;
  }) => {
    if (options.skipLog) return;
    await recordAiLog({
      userId: options.userId,
      feature: options.logFeature || "ai_chat",
      model: res.model,
      durationMs: Date.now() - startedAt,
      status: res.status,
      inputPrompt: promptText,
      thinking: res.thinking || null,
      rawOutput: res.rawOutput || null,
      errorMessage: res.errorMessage || null,
    });
  };

  try {
    // Use Ollama native /api/chat when think is explicitly set (true or false)
    // so Qwen 3.5 respects think:false reliably and exposes message.thinking when think:true
    if (isOllama && options.think !== undefined) {
      const ollamaRoot = cfg.baseUrl.replace(/\/v1\/?$/i, "");
      const ollamaEndpoint = `${ollamaRoot}/api/chat`;
      const ollamaMessages = options.messages.map((m) => {
        if (typeof m.content === "string") {
          return { role: m.role, content: m.content };
        }
        const textParts: string[] = [];
        for (const part of m.content) {
          if (part.type === "text") textParts.push(part.text);
        }
        return { role: m.role, content: textParts.join("\n") };
      });

      const nativeBody = JSON.stringify({
        model: selectedModel,
        messages: ollamaMessages,
        stream: false,
        think: options.think,
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

      try {
        const nativeRes = await postAiHttpStream({
          url: ollamaEndpoint,
          headers: { "Content-Type": "application/json" },
          body: nativeBody,
          timeoutMs,
          signal: options.signal,
        });
        const nativeText = await readIncomingText(nativeRes.stream);
        if (nativeRes.statusCode >= 200 && nativeRes.statusCode < 300) {
          const parsed = JSON.parse(nativeText) as {
            model?: string;
            message?: { content?: string; thinking?: string };
          };
          const rawMsg = parsed.message?.content?.trim() || "";
          const { cleanContent, extractedThinking } = splitInlineThinkTags(rawMsg);
          const thinking = [parsed.message?.thinking?.trim(), extractedThinking]
            .filter(Boolean)
            .join("\n\n");
          const finalContent = cleanContent || rawMsg;
          if (finalContent) {
            const finalModel = parsed.model || selectedModel;
            await saveLog({
              status: "SUCCESS",
              model: finalModel,
              thinking,
              rawOutput: finalContent,
            });
            return { content: finalContent, thinking, model: finalModel };
          }
        }
      } catch {
        // Fall through to OpenAI-compatible endpoint
      }
    }

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
      ...(options.think === false ? { reasoning_effort: "none" } : {}),
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
        signal: options.signal,
      });
    } catch (err) {
      if (options.signal?.aborted) {
        throw new Error("Request stopped by user");
      }
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
      delete bodyObj.reasoning_effort;
      httpRes = await postAiHttpStream({
        url: endpoint,
        headers,
        body: JSON.stringify(bodyObj),
        timeoutMs,
        signal: options.signal,
      });
      resText = await readIncomingText(httpRes.stream);
    }

    if (httpRes.statusCode < 200 || httpRes.statusCode >= 300) {
      throw new Error(
        `AI provider returned HTTP ${httpRes.statusCode}: ${resText.slice(0, 240) || httpRes.statusMessage}`,
      );
    }

    const data = JSON.parse(resText) as {
      choices?: Array<{
        message?: {
          content?: string;
          reasoning?: string;
          reasoning_content?: string;
        };
      }>;
      model?: string;
    };
    const msgObj = data.choices?.[0]?.message;
    const rawContent = msgObj?.content?.trim() || "";
    const { cleanContent, extractedThinking } = splitInlineThinkTags(rawContent);
    const thinking = [
      msgObj?.reasoning?.trim(),
      msgObj?.reasoning_content?.trim(),
      extractedThinking,
    ]
      .filter(Boolean)
      .join("\n\n");
    const content = cleanContent || rawContent;
    if (!content) {
      throw new Error("AI provider returned an empty response.");
    }

    const finalModel = data.model || selectedModel;
    await saveLog({
      status: "SUCCESS",
      model: finalModel,
      thinking,
      rawOutput: content,
    });

    return { content, thinking, model: finalModel };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "AI request failed";
    await saveLog({
      status: "ERROR",
      model: selectedModel,
      errorMessage: errMsg,
    });
    throw err;
  }
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
  logFeature?: string;
  skipLog?: boolean;
  signal?: AbortSignal;
  onToken: (token: string) => void;
  onThinking?: (thinkingToken: string) => void;
}): Promise<{ content: string; thinking: string; model: string }> {
  const startedAt = Date.now();
  const cfg = await getUserAiConfig(options.userId);
  const selectedModel =
    options.tier === "fast" && cfg.fastModel?.trim()
      ? cfg.fastModel.trim()
      : cfg.model;
  const promptText = formatMessagesForLog(options.messages);

  const saveStreamLog = async (res: {
    status: "SUCCESS" | "ERROR" | "STOPPED";
    model: string;
    thinking?: string;
    rawOutput?: string;
    errorMessage?: string;
  }) => {
    if (options.skipLog) return;
    await recordAiLog({
      userId: options.userId,
      feature: options.logFeature || "ai_stream",
      model: res.model,
      durationMs: Date.now() - startedAt,
      status: res.status,
      inputPrompt: promptText,
      thinking: res.thinking || null,
      rawOutput: res.rawOutput || null,
      errorMessage: res.errorMessage || null,
    });
  };

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
        signal: options.signal,
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

      const onNativeAbort = () => {
        nativeRes?.stream.destroy(new Error("Request stopped by user"));
      };
      options.signal?.addEventListener("abort", onNativeAbort, { once: true });

      try {
        for await (const chunk of nativeRes.stream) {
          nBuf += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
          const lines = nBuf.split(/\r?\n/);
          nBuf = lines.pop() || "";
          for (const l of lines) parseNativeLine(l);
        }
        if (nBuf.trim()) parseNativeLine(nBuf);
      } catch (err) {
        if (options.signal?.aborted) {
          await saveStreamLog({
            status: "STOPPED",
            model: nModel,
            thinking: nThinking.trim(),
            rawOutput: nContent.trim() || undefined,
            errorMessage: "Stopped by user",
          });
          throw new Error("Request stopped by user");
        }
        throw err;
      } finally {
        options.signal?.removeEventListener("abort", onNativeAbort);
      }

      const trimmed = nContent.trim();
      if (trimmed) {
        await saveStreamLog({
          status: "SUCCESS",
          model: nModel,
          thinking: nThinking.trim(),
          rawOutput: trimmed,
        });
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
      signal: options.signal,
    });
  } catch (err) {
    if (options.signal?.aborted) {
      await saveStreamLog({
        status: "STOPPED",
        model: selectedModel,
        errorMessage: "Stopped by user",
      });
      throw new Error("Request stopped by user");
    }
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
      signal: options.signal,
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
    if (!text) {
      await saveStreamLog({
        status: "ERROR",
        model: data.model || selectedModel,
        thinking: think,
        errorMessage: "AI provider returned an empty response.",
      });
      throw new Error("AI provider returned an empty response.");
    }
    options.onToken(text);
    await saveStreamLog({
      status: "SUCCESS",
      model: data.model || selectedModel,
      thinking: think,
      rawOutput: text,
    });
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

  const onStreamAbort = () => {
    httpRes.stream.destroy(new Error("Request stopped by user"));
  };
  options.signal?.addEventListener("abort", onStreamAbort, { once: true });

  try {
    for await (const chunk of httpRes.stream) {
      buffer += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const rawLine of lines) processLine(rawLine);
      if (!fullContent) {
        const abortReason = detectThinkingAbort(fullThinking);
        if (abortReason) {
          httpRes.stream.destroy();
          await saveStreamLog({
            status: "ERROR",
            model: resolvedModel,
            thinking: fullThinking.trim(),
            errorMessage: abortReason,
          });
          throw new Error(abortReason);
        }
      }
    }
    if (buffer.trim()) processLine(buffer);
  } catch (err) {
    if (options.signal?.aborted) {
      await saveStreamLog({
        status: "STOPPED",
        model: resolvedModel,
        thinking: fullThinking.trim(),
        rawOutput: fullContent.trim() || undefined,
        errorMessage: "Stopped by user",
      });
      throw new Error("Request stopped by user");
    }
    throw err;
  } finally {
    options.signal?.removeEventListener("abort", onStreamAbort);
  }

  const trimmed = fullContent.trim();
  if (!trimmed) {
    const errMsg = fullThinking.trim()
      ? "AI spent its entire response thinking without emitting final output. Try a faster model (e.g. Gemini 2.5 Flash) or increase max timeout."
      : "AI provider stream ended with an empty response.";
    await saveStreamLog({
      status: "ERROR",
      model: resolvedModel,
      thinking: fullThinking.trim(),
      errorMessage: errMsg,
    });
    throw new Error(errMsg);
  }

  await saveStreamLog({
    status: "SUCCESS",
    model: resolvedModel,
    thinking: fullThinking.trim(),
    rawOutput: trimmed,
  });

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

export async function ensureNoteText(
  note: {
    id: string;
    fileName: string;
    fileType: string;
    filePath: string;
    extractedText: string | null;
  },
  options?: { refreshIfLegacyTruncated?: boolean },
): Promise<string | null> {
  const legacyTruncated =
    options?.refreshIfLegacyTruncated &&
    note.extractedText &&
    note.extractedText.length >= 34800 &&
    note.extractedText.length <= 35100;

  if (note.extractedText && !legacyTruncated) return note.extractedText;

  const fullPath = path.resolve(UPLOAD_ROOT, note.filePath);
  if (!fullPath.startsWith(UPLOAD_ROOT)) return note.extractedText;
  const buffer = await fs.readFile(fullPath).catch(() => null);
  if (!buffer) return note.extractedText;
  const text = await extractTextFromBuffer(buffer, note.fileName, note.fileType);
  if (text && text !== note.extractedText) {
    await prisma.note
      .update({ where: { id: note.id }, data: { extractedText: text } })
      .catch(() => {});
    return text;
  }
  return note.extractedText || text;
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

  const aiTz = resolveTimeZone();
  const upcomingEvents = expandCalendarEvents(rawEvents, now, in7Days, aiTz).slice(
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

// ─── Course-Grounded Topic & Material Extraction Engine ─────────────────────

interface NoteSegment {
  index: number;
  text: string;
  lower: string;
}

function extractModNumHint(str: string): string | null {
  const m = str.match(/\b(?:module|unit|chapter|part|mod)\s*[-:#]?\s*(\d+)\b/i);
  if (m) return m[1];
  const short = str.match(/\bm\s*[-_]?(\d+)\b/i);
  return short ? short[1] : null;
}

function normalizePhrase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const TOPIC_STOP_WORDS = new Set([
  "and",
  "the",
  "for",
  "with",
  "into",
  "from",
  "using",
  "based",
  "introduction",
  "overview",
  "basics",
  "basic",
  "concepts",
  "concept",
  "principles",
  "theory",
  "applications",
  "method",
  "methods",
  "analysis",
  "study",
  "types",
  "of",
  "in",
  "on",
  "to",
  "an",
  "a",
]);

function significantTokens(str: string): string[] {
  return normalizePhrase(str)
    .split(" ")
    .filter((w) => w.length >= 2 && !TOPIC_STOP_WORDS.has(w));
}

function segmentNoteText(rawText: string, targetChunkChars = 650): NoteSegment[] {
  const normalized = rawText.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  // Split first by page/slide markers or blank lines
  const rawBlocks = normalized
    .split(/(?=\[(?:Page|Slide)\s+\d+\])|\n{2,}/g)
    .map((b) => b.trim())
    .filter(Boolean);

  const merged: string[] = [];
  let buf = "";

  for (const block of rawBlocks) {
    if (block.length > targetChunkChars * 1.6) {
      if (buf) {
        merged.push(buf);
        buf = "";
      }
      // Split overly long block cleanly by single newlines or sentences
      const lines = block.split("\n");
      let sub = "";
      for (const line of lines) {
        if (sub.length + line.length + 1 > targetChunkChars && sub.length > 220) {
          merged.push(sub.trim());
          sub = line;
        } else {
          sub = sub ? `${sub}\n${line}` : line;
        }
      }
      if (sub.trim()) merged.push(sub.trim());
      continue;
    }

    if (buf && buf.length + block.length + 2 > targetChunkChars) {
      merged.push(buf);
      buf = block;
    } else {
      buf = buf ? `${buf}\n\n${block}` : block;
    }
  }
  if (buf) merged.push(buf);

  return merged.map((text, index) => ({
    index,
    text,
    lower: text.toLowerCase(),
  }));
}

function scoreSegmentForTopic(seg: NoteSegment, topicName: string): number {
  const normTopic = normalizePhrase(topicName);
  if (!normTopic) return 0;

  const segNorm = normalizePhrase(seg.text);
  let score = 0;

  if (segNorm.includes(normTopic)) {
    score += 35;
    // Bonus if it appears near the start of the segment / line (heading match)
    const firstLines = normalizePhrase(seg.text.split("\n").slice(0, 3).join(" "));
    if (firstLines.includes(normTopic)) score += 20;
  }

  const tokens = significantTokens(topicName);
  if (tokens.length > 0) {
    let matched = 0;
    for (const tok of tokens) {
      if (seg.lower.includes(tok)) matched++;
    }
    const ratio = matched / tokens.length;
    score += Math.round(ratio * 18);
    if (tokens.length >= 2 && matched === tokens.length) score += 10;

    // Check first 2 lines for strong heading token overlap
    const headLower = seg.text.split("\n").slice(0, 2).join(" ").toLowerCase();
    let headMatched = 0;
    for (const tok of tokens) {
      if (headLower.includes(tok)) headMatched++;
    }
    if (tokens.length >= 2 && headMatched >= Math.ceil(tokens.length * 0.7)) {
      score += 12;
    }
  }

  return score;
}

function clampSpanText(parts: string[], maxChars: number): string {
  const joined = parts.join("\n\n").trim();
  if (joined.length <= maxChars) return joined;
  const headLen = Math.floor(maxChars * 0.75);
  const tailLen = Math.max(0, maxChars - headLen - 40);
  if (tailLen < 300) return joined.slice(0, maxChars);
  return `${joined.slice(0, headLen).trim()}\n\n[...middle section trimmed for context budget...]\n\n${joined.slice(-tailLen).trim()}`;
}

async function extractTopicSpanFromNote(options: {
  userId: string;
  noteText: string;
  topicName: string;
  nextTopics: string[];
  maxChars: number;
  allowFastModelFallback: boolean;
}): Promise<{ excerpt: string; confidence: number }> {
  const { userId, noteText, topicName, nextTopics, maxChars, allowFastModelFallback } =
    options;
  const segments = segmentNoteText(noteText, 650);
  if (segments.length === 0) return { excerpt: "", confidence: 0 };

  // Fast path if entire note easily fits
  if (noteText.length <= maxChars) {
    return { excerpt: noteText, confidence: 100 };
  }

  const scores = segments.map((seg) => scoreSegmentForTopic(seg, topicName));
  let bestIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < scores.length; i++) {
    if (scores[i] > bestScore) {
      bestScore = scores[i];
      bestIdx = i;
    }
  }

  // Optional 4B fastModel segment selector if heuristic match is weak
  if (bestScore < 14 && allowFastModelFallback && segments.length >= 4) {
    try {
      const stride = Math.max(1, Math.ceil(segments.length / 45));
      const sampled = segments.filter((_, idx) => idx % stride === 0).slice(0, 45);
      const previews = sampled
        .map(
          (s) =>
            `[${s.index}] ${s.text.replace(/\s+/g, " ").slice(0, 110)}`,
        )
        .join("\n");
      const reqPayload = AI_PROMPTS.selectTopicSegments({
        topicName,
        nextTopicName: nextTopics[0] || null,
        segmentPreviews: previews,
      });
      const { content } = await callAiChat({ userId, ...reqPayload });
      const parsed = extractJsonFromAi<{ indices?: number[] }>(content);
      const valid = (parsed.indices || [])
        .map((n) => Number(n))
        .filter((n) => Number.isInteger(n) && n >= 0 && n < segments.length)
        .sort((a, b) => a - b);

      if (valid.length > 0) {
        const start = Math.max(0, valid[0]);
        const end = Math.min(
          segments.length - 1,
          valid[valid.length - 1] + (stride > 1 ? stride : 1),
        );
        const picked = segments.slice(start, end + 1).map((s) => s.text);
        return {
          excerpt: clampSpanText(picked, maxChars),
          confidence: 30,
        };
      }
    } catch {
      // Fall back to deterministic scoring below
    }
  }

  if (bestScore <= 0) {
    return { excerpt: "", confidence: 0 };
  }

  // Expand forward until the next chronological topic clearly starts or budget fills
  let startIdx = Math.max(0, bestIdx);
  // Include 1 preceding segment if the match started mid-discussion without heading
  if (bestIdx > 0 && scores[bestIdx] < 30 && scores[bestIdx - 1] >= 8) {
    startIdx = bestIdx - 1;
  }

  let endIdx = startIdx;
  let runningLen = segments[startIdx].text.length;

  for (let i = startIdx + 1; i < segments.length && i <= startIdx + 12; i++) {
    // Check if any immediate next topic clearly starts here
    let nextStartsHere = false;
    for (const nt of nextTopics.slice(0, 2)) {
      const ntScore = scoreSegmentForTopic(segments[i], nt);
      if (ntScore >= 24 && ntScore > scores[i] + 6) {
        nextStartsHere = true;
        break;
      }
    }
    if (nextStartsHere && i > startIdx + 1) break;

    if (runningLen + segments[i].text.length > maxChars * 1.35 && i > startIdx + 2) {
      break;
    }
    endIdx = i;
    runningLen += segments[i].text.length;
  }

  const spanParts = segments.slice(startIdx, endIdx + 1).map((s) => s.text);
  return {
    excerpt: clampSpanText(spanParts, maxChars),
    confidence: bestScore,
  };
}

function extractQuerySpanFromNote(
  noteText: string,
  query: string,
  maxChars: number,
): { excerpt: string; score: number } {
  const segments = segmentNoteText(noteText, 600);
  if (segments.length === 0) return { excerpt: "", score: 0 };
  if (noteText.length <= maxChars) {
    return { excerpt: noteText, score: 10 };
  }

  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) {
    return { excerpt: noteText.slice(0, maxChars), score: 1 };
  }

  const normQuery = normalizePhrase(query);
  const segScores = segments.map((s) => {
    let sc = 0;
    const sNorm = normalizePhrase(s.text);
    if (normQuery.length >= 6 && sNorm.includes(normQuery)) sc += 25;
    let hits = 0;
    for (const t of tokens) {
      if (s.lower.includes(t)) hits++;
    }
    sc += hits * 5;
    if (tokens.length >= 2 && hits === tokens.length) sc += 10;
    return sc;
  });

  // Pick top 2 non-overlapping peak indices and expand ±1 neighbor
  const ranked = segScores
    .map((sc, idx) => ({ sc, idx }))
    .filter((x) => x.sc > 0)
    .sort((a, b) => b.sc - a.sc);

  if (ranked.length === 0) {
    return { excerpt: "", score: 0 };
  }

  const chosenIndices = new Set<number>();
  for (const peak of ranked.slice(0, 3)) {
    for (
      let j = Math.max(0, peak.idx - 1);
      j <= Math.min(segments.length - 1, peak.idx + 1);
      j++
    ) {
      chosenIndices.add(j);
    }
    const approxLen = Array.from(chosenIndices).reduce(
      (sum, idx) => sum + segments[idx].text.length,
      0,
    );
    if (approxLen >= maxChars) break;
  }

  const ordered = Array.from(chosenIndices).sort((a, b) => a - b);
  const parts: string[] = [];
  let prev = -2;
  for (const idx of ordered) {
    if (prev !== -2 && idx > prev + 1) {
      parts.push("[...]");
    }
    parts.push(segments[idx].text);
    prev = idx;
  }

  return {
    excerpt: clampSpanText(parts, maxChars),
    score: ranked[0].sc,
  };
}

function cleanPdfWhitespace(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractPageRangeFromNote(
  noteText: string,
  startPage: number,
  endPage: number,
  maxChars: number,
): string | null {
  const safeStart = Math.max(1, startPage);
  const safeEnd = Math.max(safeStart, endPage);
  const markerRe = /\[(Page|Slide)\s+(\d+)\]/gi;
  const markers: Array<{ page: number; index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = markerRe.exec(noteText)) !== null) {
    markers.push({ page: Number(m[2]), index: m.index });
  }
  if (markers.length === 0) return null;

  const startMarker =
    markers.find((mk) => mk.page >= safeStart) || markers[0];
  const afterEndMarker = markers.find((mk) => mk.page > safeEnd);
  const sliceStart = startMarker.index;
  const sliceEnd = afterEndMarker ? afterEndMarker.index : noteText.length;

  if (sliceEnd <= sliceStart) return null;
  const cleaned = cleanPdfWhitespace(noteText.slice(sliceStart, sliceEnd));
  if (!cleaned) return null;
  if (cleaned.length <= maxChars) return cleaned;
  return clampSpanText([cleaned], maxChars);
}

export interface CourseStudyContext {
  subject: { id: string; name: string; code: string | null } | null;
  module: {
    id: string;
    name: string;
    topics: Array<{ id: string; name: string; isCompleted: boolean; order: number }>;
  } | null;
  topic: {
    id: string;
    name: string;
    isCompleted: boolean;
    order: number;
    index: number;
    total: number;
    startPage?: number | null;
    endPage?: number | null;
  } | null;
  prevTopic: { id: string; name: string; isCompleted: boolean } | null;
  nextTopic: { id: string; name: string; isCompleted: boolean } | null;
  moduleRoadmap: string;
  syllabusContext: string;
  materialExcerpts: string;
  openedNotes: Array<{
    id: string;
    title: string;
    fileName: string;
    subjectName: string | null;
  }>;
}

export async function buildCourseStudyContext(options: {
  userId: string;
  query: string;
  subjectId?: string | null;
  moduleId?: string | null;
  topicId?: string | null;
  maxMaterialChars?: number;
}): Promise<CourseStudyContext> {
  const {
    userId,
    query,
    subjectId: reqSubjectId,
    moduleId: reqModuleId,
    topicId: reqTopicId,
    maxMaterialChars = 6200,
  } = options;

  const [subjects, allNotes, aiConfig] = await Promise.all([
    prisma.subject.findMany({
      where: { userId },
      include: {
        modules: {
          orderBy: { order: "asc" },
          include: { topics: { orderBy: { order: "asc" } } },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.note.findMany({
      where: { userId },
      include: { subject: { select: { id: true, name: true, code: true } } },
      orderBy: { uploadedAt: "desc" },
    }),
    getUserAiConfig(userId),
  ]);

  // Resolve target topic/module/subject cleanly (explicit IDs take top priority)
  let activeSubject =
    (reqSubjectId ? subjects.find((s) => s.id === reqSubjectId) : undefined) ||
    null;
  let activeModule: (typeof subjects)[number]["modules"][number] | null = null;
  let activeTopic:
    | (typeof subjects)[number]["modules"][number]["topics"][number]
    | null = null;

  if (reqTopicId) {
    for (const s of subjects) {
      for (const m of s.modules) {
        const found = m.topics.find((t) => t.id === reqTopicId);
        if (found) {
          activeSubject = s;
          activeModule = m;
          activeTopic = found;
          break;
        }
      }
      if (activeTopic) break;
    }
  }

  if (!activeModule && reqModuleId) {
    for (const s of subjects) {
      const found = s.modules.find((m) => m.id === reqModuleId);
      if (found) {
        activeSubject = s;
        activeModule = found;
        break;
      }
    }
  }

  // Auto-detect subject/module/topic from query if not explicitly pinned
  const queryTokens = tokenizeQuery(query);
  if (!activeSubject && subjects.length > 0 && queryTokens.length > 0) {
    let bestSubScore = 0;
    for (const s of subjects) {
      let sc = 0;
      const sText = `${s.name} ${s.code || ""}`.toLowerCase();
      for (const tok of queryTokens) {
        if (sText.includes(tok)) sc += 15;
      }
      for (const m of s.modules) {
        const mText = m.name.toLowerCase();
        for (const tok of queryTokens) {
          if (mText.includes(tok)) sc += 8;
        }
        for (const t of m.topics) {
          const tText = t.name.toLowerCase();
          for (const tok of queryTokens) {
            if (tText.includes(tok)) sc += 5;
          }
        }
      }
      if (sc > bestSubScore) {
        bestSubScore = sc;
        activeSubject = s;
      }
    }
  }

  if (activeSubject && !activeModule && queryTokens.length > 0) {
    let bestModScore = 0;
    for (const m of activeSubject.modules) {
      let sc = 0;
      const mText = m.name.toLowerCase();
      for (const tok of queryTokens) {
        if (mText.includes(tok)) sc += 10;
      }
      for (const t of m.topics) {
        const tText = t.name.toLowerCase();
        for (const tok of queryTokens) {
          if (tText.includes(tok)) sc += 6;
        }
      }
      if (sc > bestModScore) {
        bestModScore = sc;
        activeModule = m;
      }
    }
  }

  // Fallback if only 1 subject exists
  if (!activeSubject && subjects.length === 1) {
    activeSubject = subjects[0];
  }

  // Build compact roadmap & syllabus strings (ONLY for active subject!)
  let moduleRoadmap = "";
  let prevTopic: { id: string; name: string; isCompleted: boolean } | null = null;
  let nextTopic: { id: string; name: string; isCompleted: boolean } | null = null;
  let topicMeta: CourseStudyContext["topic"] = null;

  if (activeModule) {
    const idx = activeTopic
      ? activeModule.topics.findIndex((t) => t.id === activeTopic!.id)
      : -1;
    if (idx !== -1 && activeTopic) {
      topicMeta = {
        id: activeTopic.id,
        name: activeTopic.name,
        isCompleted: activeTopic.isCompleted,
        order: activeTopic.order,
        index: idx,
        total: activeModule.topics.length,
        startPage: activeTopic.startPage,
        endPage: activeTopic.endPage,
      };
      if (idx > 0) {
        const p = activeModule.topics[idx - 1];
        prevTopic = { id: p.id, name: p.name, isCompleted: p.isCompleted };
      }
      if (idx + 1 < activeModule.topics.length) {
        const n = activeModule.topics[idx + 1];
        nextTopic = { id: n.id, name: n.name, isCompleted: n.isCompleted };
      }
    }

    moduleRoadmap = activeModule.topics
      .map((t, i) => {
        const status =
          activeTopic?.id === t.id
            ? "CURRENT"
            : t.isCompleted
              ? "Done"
              : "Remaining";
        return `${i + 1}. ${t.name} [${status}]`;
      })
      .join("\n");
  }

  const syllabusLines: string[] = [];
  if (activeSubject) {
    syllabusLines.push(
      `Subject: ${activeSubject.name}${activeSubject.code ? ` (${activeSubject.code})` : ""}`,
    );
    if (activeModule) {
      syllabusLines.push(`Module: ${activeModule.name}`);
      syllabusLines.push(moduleRoadmap || "(No topics in this module)");
    } else {
      for (const m of activeSubject.modules) {
        const done = m.topics.filter((t) => t.isCompleted).length;
        const rem = m.topics.filter((t) => !t.isCompleted).map((t) => t.name);
        syllabusLines.push(
          `• ${m.name} (${done}/${m.topics.length} done)${rem.length > 0 ? ` — Remaining: ${rem.slice(0, 8).join(", ")}` : ""}`,
        );
      }
    }
  } else if (subjects.length > 0) {
    syllabusLines.push(
      `Available Subjects: ${subjects.map((s) => s.name).join(", ")}`,
    );
  } else {
    syllabusLines.push("No subjects or syllabus created yet.");
  }

  // Filter candidate notes strictly to active subject & module
  let candidateNotes = activeSubject
    ? allNotes.filter((n) => n.subjectId === activeSubject!.id)
    : allNotes;

  if (activeModule && candidateNotes.length > 1) {
    const targetModNum = extractModNumHint(activeModule.name);
    if (targetModNum) {
      const matchingOrUntagged = candidateNotes.filter((n) => {
        const nNum = extractModNumHint(`${n.title} ${n.fileName}`);
        return !nNum || nNum === targetModNum;
      });
      if (matchingOrUntagged.length > 0) {
        candidateNotes = matchingOrUntagged;
      }
    }
  }

  // Ensure extractedText is present for candidate notes and score them
  const loadedNotes: Array<{
    note: (typeof candidateNotes)[number];
    text: string;
    score: number;
  }> = [];

  const targetModNum = activeModule ? extractModNumHint(activeModule.name) : null;
  const searchTerms = activeTopic
    ? significantTokens(activeTopic.name)
    : queryTokens;

  for (const n of candidateNotes.slice(0, 12)) {
    const text = await ensureNoteText(n);
    if (!text) continue;

    let score = 1;
    const header = `${n.title} ${n.fileName}`;
    const nModNum = extractModNumHint(header);
    if (targetModNum && nModNum === targetModNum) score += 60;

    if (activeTopic) {
      const normTopic = normalizePhrase(activeTopic.name);
      if (normTopic && normalizePhrase(text).includes(normTopic)) {
        score += 45;
      }
    }

    const headerLower = header.toLowerCase();
    const textLower = text.toLowerCase();
    for (const tok of searchTerms) {
      if (headerLower.includes(tok)) score += 10;
      if (textLower.includes(tok)) score += 4;
    }

    loadedNotes.push({ note: n, text, score });
  }

  loadedNotes.sort((a, b) => b.score - a.score);

  const openedNotes: CourseStudyContext["openedNotes"] = [];
  const excerptBlocks: string[] = [];
  let remainingBudget = maxMaterialChars;
  const allowFastFallback = Boolean(aiConfig.fastModel?.trim());

  if (activeTopic) {
    // Fast exact-page lookup when startPage/endPage were captured during topic extraction
    if (activeTopic.startPage != null) {
      const targetNoteItem =
        (activeTopic.sourceNoteId
          ? loadedNotes.find((l) => l.note.id === activeTopic.sourceNoteId)
          : undefined) || loadedNotes[0];

      if (targetNoteItem) {
        const endP = activeTopic.endPage ?? activeTopic.startPage + 2;
        const pageExcerpt = extractPageRangeFromNote(
          targetNoteItem.text,
          activeTopic.startPage,
          endP,
          Math.min(remainingBudget, 5400),
        );
        if (pageExcerpt) {
          openedNotes.push({
            id: targetNoteItem.note.id,
            title: targetNoteItem.note.title,
            fileName: targetNoteItem.note.fileName,
            subjectName: targetNoteItem.note.subject?.name || null,
          });
          excerptBlocks.push(
            `[Source: ${targetNoteItem.note.title} (${targetNoteItem.note.fileName}) | Pages ${activeTopic.startPage}–${endP}]\n${pageExcerpt}`,
          );
          remainingBudget -= pageExcerpt.length;
        }
      }
    }

    if (excerptBlocks.length === 0) {
      const nextTopicNames = activeModule
        ? activeModule.topics
            .slice((topicMeta?.index ?? 0) + 1)
            .map((t) => t.name)
        : [];

      for (const item of loadedNotes.slice(0, 2)) {
        if (remainingBudget < 500) break;
        const { excerpt, confidence } = await extractTopicSpanFromNote({
          userId,
          noteText: cleanPdfWhitespace(item.text),
          topicName: activeTopic.name,
          nextTopics: nextTopicNames,
          maxChars: Math.min(remainingBudget, 4800),
          allowFastModelFallback:
            allowFastFallback && excerptBlocks.length === 0,
        });

        if (excerpt && (confidence > 0 || excerptBlocks.length === 0)) {
          openedNotes.push({
            id: item.note.id,
            title: item.note.title,
            fileName: item.note.fileName,
            subjectName: item.note.subject?.name || null,
          });
          excerptBlocks.push(
            `[Source: ${item.note.title} (${item.note.fileName})]\n${excerpt}`,
          );
          remainingBudget -= excerpt.length;
        }
      }
    }
  } else {
    for (const item of loadedNotes.slice(0, 3)) {
      if (remainingBudget < 500) break;
      const { excerpt, score } = extractQuerySpanFromNote(
        item.text,
        query,
        Math.min(remainingBudget, 3200),
      );
      if (excerpt && (score > 0 || excerptBlocks.length === 0)) {
        openedNotes.push({
          id: item.note.id,
          title: item.note.title,
          fileName: item.note.fileName,
          subjectName: item.note.subject?.name || null,
        });
        excerptBlocks.push(
          `[Source: ${item.note.title} (${item.note.fileName})]\n${excerpt}`,
        );
        remainingBudget -= excerpt.length;
      }
    }
  }

  return {
    subject: activeSubject
      ? {
          id: activeSubject.id,
          name: activeSubject.name,
          code: activeSubject.code,
        }
      : null,
    module: activeModule
      ? {
          id: activeModule.id,
          name: activeModule.name,
          topics: activeModule.topics.map((t) => ({
            id: t.id,
            name: t.name,
            isCompleted: t.isCompleted,
            order: t.order,
          })),
        }
      : null,
    topic: topicMeta,
    prevTopic,
    nextTopic,
    moduleRoadmap,
    syllabusContext: syllabusLines.join("\n"),
    materialExcerpts: excerptBlocks.join("\n\n---\n\n"),
    openedNotes,
  };
}
