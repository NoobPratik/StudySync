import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getApiUser } from "@/lib/session";
import { callAiChat, getUserAiConfig } from "@/lib/ai";
import { AI_PROMPTS } from "@/lib/ai-prompts";

const updateAiConfigSchema = z.object({
  baseUrl: z.string().url("Valid API Base URL is required"),
  apiKey: z.string().max(300).optional().nullable(),
  model: z.string().min(1, "Primary model name is required").max(120),
  fastModel: z.string().max(120).optional().nullable(),
  timeoutSeconds: z.number().int().min(30).max(900).default(300),
  customInstructions: z.string().max(2000).optional().nullable(),
  temperature: z.number().min(0).max(2).default(0.4),
  debugMode: z.boolean().default(false),
});

export async function GET() {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cfg = await getUserAiConfig(user.id);
  return NextResponse.json({
    config: {
      baseUrl: cfg.baseUrl,
      hasApiKey: Boolean(cfg.apiKey),
      maskedApiKey: cfg.apiKey
        ? `${cfg.apiKey.slice(0, 4)}••••${cfg.apiKey.slice(-4)}`
        : "",
      model: cfg.model,
      fastModel: cfg.fastModel || "",
      timeoutSeconds: cfg.timeoutSeconds,
      customInstructions: cfg.customInstructions || "",
      temperature: cfg.temperature,
      debugMode: cfg.debugMode,
    },
  });
}

export async function PUT(request: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = updateAiConfigSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid AI config" },
        { status: 400 },
      );
    }

    const d = parsed.data;
    const existing = await prisma.aiConfig.findUnique({
      where: { userId: user.id },
    });

    const nextApiKey =
      d.apiKey === undefined
        ? existing?.apiKey ?? null
        : d.apiKey === ""
          ? null
          : d.apiKey;

    const saved = await prisma.aiConfig.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        baseUrl: d.baseUrl.replace(/\/+$/, ""),
        apiKey: nextApiKey,
        model: d.model.trim(),
        fastModel: d.fastModel?.trim() || null,
        timeoutSeconds: d.timeoutSeconds,
        customInstructions: d.customInstructions?.trim() || null,
        temperature: d.temperature,
        debugMode: d.debugMode,
      },
      update: {
        baseUrl: d.baseUrl.replace(/\/+$/, ""),
        apiKey: nextApiKey,
        model: d.model.trim(),
        fastModel: d.fastModel?.trim() || null,
        timeoutSeconds: d.timeoutSeconds,
        customInstructions: d.customInstructions?.trim() || null,
        temperature: d.temperature,
        debugMode: d.debugMode,
      },
    });

    return NextResponse.json({
      config: {
        baseUrl: saved.baseUrl,
        hasApiKey: Boolean(saved.apiKey),
        maskedApiKey: saved.apiKey
          ? `${saved.apiKey.slice(0, 4)}••••${saved.apiKey.slice(-4)}`
          : "",
        model: saved.model,
        fastModel: saved.fastModel || "",
        timeoutSeconds: saved.timeoutSeconds,
        customInstructions: saved.customInstructions || "",
        temperature: saved.temperature,
        debugMode: saved.debugMode,
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to save AI configuration" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action as string | undefined;

    if (action === "list_models") {
      const cfg = await getUserAiConfig(user.id);
      const baseUrl = (
        typeof body.baseUrl === "string" && body.baseUrl.trim()
          ? body.baseUrl.trim()
          : cfg.baseUrl
      ).replace(/\/+$/, "");
      const apiKey =
        typeof body.apiKey === "string" && body.apiKey.trim()
          ? body.apiKey.trim()
          : cfg.apiKey;

      const res = await fetch(`${baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${apiKey || "ollama"}`,
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        return NextResponse.json(
          { error: `Failed to fetch models (HTTP ${res.status})` },
          { status: 400 },
        );
      }

      const data = (await res.json()) as {
        data?: Array<{ id: string }>;
        models?: Array<{ name?: string; id?: string }>;
      };
      const models = (
        data.data?.map((m) => m.id) ||
        data.models?.map((m) => m.id || m.name || "") ||
        []
      ).filter(Boolean);

      return NextResponse.json({ models });
    }

    const aiRequest = AI_PROMPTS.connectionTest(
      body.tier === "fast" ? "fast" : "primary",
    );
    const result = await callAiChat({
      userId: user.id,
      ...aiRequest,
    });

    return NextResponse.json({
      ok: true,
      reply: result.content,
      model: result.model,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to connect to AI model",
      },
      { status: 400 },
    );
  }
}
