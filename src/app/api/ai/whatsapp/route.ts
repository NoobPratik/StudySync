import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiUser } from "@/lib/session";
import { callAiChat, extractJsonFromAi } from "@/lib/ai";
import { AI_PROMPTS } from "@/lib/ai-prompts";

const ACADEMIC_KEYWORDS =
  /\b(assignment|assign|submit|submission|due|deadline|exam|test|quiz|viva|lab|record|mid[\s-]?sem|end[\s-]?sem|project|presentation|ppt|pdf|notes|module|syllabus|holiday|lecture|class|cancelled|rescheduled|room|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday)\b/i;

function preprocessWhatsAppChat(raw: string): string {
  const lines = raw.split(/\r?\n/);
  // Keep lines with academic relevance or the tail of the chat if short
  if (raw.length <= 12000) return raw;

  const filtered: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (ACADEMIC_KEYWORDS.test(line)) {
      filtered.push(line);
      // include immediate follow-up line if it looks like a continuation
      if (i + 1 < lines.length && !/^\d{1,2}[\/\-]\d{1,2}/.test(lines[i + 1])) {
        filtered.push(lines[i + 1]);
      }
    }
  }

  const combined = filtered.join("\n");
  if (combined.length > 0) {
    return combined.slice(-14000);
  }
  return raw.slice(-14000);
}

export async function POST(request: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    let rawText = "";
    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file");
      const pasted = formData.get("text");
      if (file instanceof File) {
        rawText = await file.text();
      } else if (typeof pasted === "string") {
        rawText = pasted;
      }
    } else {
      const body = await request.json();
      rawText = typeof body.text === "string" ? body.text : "";
    }

    if (!rawText.trim()) {
      return NextResponse.json(
        { error: "Please upload a WhatsApp .txt export or paste chat messages." },
        { status: 400 },
      );
    }

    const subjects = await prisma.subject.findMany({
      where: { userId: user.id },
      select: { id: true, name: true, code: true },
    });

    const filteredChat = preprocessWhatsAppChat(rawText);
    const nowIso = new Date().toISOString();
    const subjectsSummary = subjects
      .map((s) => `${s.name}${s.code ? ` (${s.code})` : ""} [id=${s.id}]`)
      .join(", ");

    const aiRequest = AI_PROMPTS.whatsappExtract({
      nowIso,
      subjectsSummary,
      filteredChat,
    });

    const { content } = await callAiChat({
      userId: user.id,
      ...aiRequest,
    });

    const extracted = extractJsonFromAi<{
      deadlines?: Array<Record<string, unknown>>;
      events?: Array<Record<string, unknown>>;
      materials?: Array<Record<string, unknown>>;
    }>(content);

    return NextResponse.json({
      deadlines: extracted.deadlines || [],
      events: extracted.events || [],
      materials: extracted.materials || [],
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to parse WhatsApp chat",
      },
      { status: 400 },
    );
  }
}
