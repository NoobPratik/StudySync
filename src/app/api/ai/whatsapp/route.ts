import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiUser } from "@/lib/session";
import { callAiChat, extractJsonFromAi } from "@/lib/ai";
import { AI_PROMPTS } from "@/lib/ai-prompts";

const ACADEMIC_KEYWORDS =
  /\b(assignment|assign|submit|submission|due|deadline|exam|test|quiz|viva|lab|record|mid[\s-]?sem|end[\s-]?sem|project|presentation|ppt|pdf|notes|module|syllabus|holiday|lecture|class|cancelled|rescheduled|room|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday)\b/i;

const NOISE_LINES =
  /^(\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}(?:\s*[ap]m)?\s*-\s*.*:\s*)?(<Media omitted>|This message was deleted|You deleted this message|Messages and calls are end-to-end encrypted.*)$/i;

function preprocessWhatsAppChat(raw: string): string {
  const cleanedLines = raw
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0 && !NOISE_LINES.test(l.trim()));

  const cleaned = cleanedLines.join("\n");
  if (cleaned.length <= 12000) return cleaned;

  const keepIndices = new Set<number>();
  for (let i = 0; i < cleanedLines.length; i++) {
    if (ACADEMIC_KEYWORDS.test(cleanedLines[i])) {
      if (i - 1 >= 0) keepIndices.add(i - 1);
      keepIndices.add(i);
      if (i + 1 < cleanedLines.length) keepIndices.add(i + 1);
    }
  }

  if (keepIndices.size > 0) {
    const ordered = Array.from(keepIndices)
      .sort((a, b) => a - b)
      .map((idx) => cleanedLines[idx])
      .join("\n");
    return ordered.slice(-14000);
  }
  return cleaned.slice(-14000);
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
      logFeature: "whatsapp_extract",
      signal: request.signal,
      ...aiRequest,
    });

    const extracted = extractJsonFromAi<{
      deadlines?: Array<Record<string, unknown>>;
      events?: Array<Record<string, unknown>>;
      materials?: Array<Record<string, unknown>>;
    }>(content);

    const validSubjectIds = new Set(subjects.map((s) => s.id));
    const VALID_DEADLINE_TYPES = new Set([
      "ASSIGNMENT",
      "LAB_EXAM",
      "TEST",
      "MID_SEM",
      "END_SEM",
      "PROJECT",
      "OTHER",
    ]);
    const VALID_PRIORITIES = new Set(["LOW", "MEDIUM", "HIGH", "URGENT"]);
    const VALID_EVENT_TYPES = new Set([
      "LECTURE",
      "HOLIDAY",
      "EXAM",
      "LAB",
      "CUSTOM",
    ]);

    const fallbackDue = new Date(Date.now() + 7 * 86400_000).toISOString();
    const safeIso = (val: unknown, fallback: string) => {
      if (typeof val !== "string" || !val.trim()) return fallback;
      const d = new Date(val);
      return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
    };

    const normalizedDeadlines = (extracted.deadlines || [])
      .filter((d) => typeof d.title === "string" && d.title.trim().length > 0)
      .map((d) => {
        let dt = String(d.deadlineType || "ASSIGNMENT").toUpperCase();
        if (dt === "QUIZ") dt = "TEST";
        let pr = String(d.priority || "MEDIUM").toUpperCase();
        if (pr === "CRITICAL") pr = "URGENT";
        const sid =
          typeof d.subjectId === "string" && validSubjectIds.has(d.subjectId)
            ? d.subjectId
            : null;
        return {
          title: String(d.title).trim().slice(0, 180),
          description:
            typeof d.description === "string" ? d.description.trim() : undefined,
          deadlineType: VALID_DEADLINE_TYPES.has(dt) ? dt : "ASSIGNMENT",
          dueAt: safeIso(d.dueAt, fallbackDue),
          priority: VALID_PRIORITIES.has(pr) ? pr : "MEDIUM",
          subjectId: sid,
          writeupHint:
            typeof d.writeupHint === "string" ? d.writeupHint.trim() : undefined,
        };
      });

    const normalizedEvents = (extracted.events || [])
      .filter((ev) => typeof ev.title === "string" && ev.title.trim().length > 0)
      .map((ev) => {
        const et = String(ev.eventType || "CUSTOM").toUpperCase();
        const startIso = safeIso(ev.startAt, nowIso);
        const defaultEnd = new Date(
          new Date(startIso).getTime() + 3600_000,
        ).toISOString();
        return {
          title: String(ev.title).trim().slice(0, 180),
          eventType: VALID_EVENT_TYPES.has(et) ? et : "CUSTOM",
          startAt: startIso,
          endAt: safeIso(ev.endAt, defaultEnd),
          location:
            typeof ev.location === "string" && ev.location.trim()
              ? ev.location.trim()
              : null,
          description:
            typeof ev.description === "string" && ev.description.trim()
              ? ev.description.trim()
              : null,
        };
      });

    const normalizedMaterials = (extracted.materials || []).filter(
      (m) => typeof m.name === "string" && m.name.trim().length > 0,
    );

    return NextResponse.json({
      deadlines: normalizedDeadlines,
      events: normalizedEvents,
      materials: normalizedMaterials,
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
