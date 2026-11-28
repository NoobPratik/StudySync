import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getApiUser } from "@/lib/session";
import {
  callAiChat,
  ensureNoteText,
  extractJsonFromAi,
} from "@/lib/ai";
import { AI_PROMPTS } from "@/lib/ai-prompts";

export async function GET() {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const decks = await prisma.flashcardDeck.findMany({
    where: { userId: user.id },
    include: {
      subject: { select: { id: true, name: true, code: true, color: true } },
      cards: { orderBy: { nextReviewAt: "asc" } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ decks });
}

const generateDeckSchema = z.object({
  subjectId: z.string().min(1, "Please select a subject"),
  moduleId: z.string().optional().nullable(),
  noteIds: z.array(z.string()).optional(),
  title: z.string().max(160).optional(),
  count: z.number().int().min(4).max(20).default(10),
});

function tokenize(str: string): string[] {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3);
}

function extractModNum(str: string): string | null {
  const m = str.match(/\b(?:module|unit|chapter|mod|m)\s*[-:#]?\s*(\d+)\b/i);
  return m ? m[1] : null;
}

export async function POST(request: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = generateDeckSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid request" },
        { status: 400 },
      );
    }

    const { subjectId, moduleId, noteIds, title, count } = parsed.data;

    const subject = await prisma.subject.findFirst({
      where: { id: subjectId, userId: user.id },
      include: {
        modules: {
          orderBy: { order: "asc" },
          include: { topics: { orderBy: { order: "asc" } } },
        },
      },
    });

    if (!subject) {
      return NextResponse.json({ error: "Subject not found" }, { status: 404 });
    }

    const selectedModule = moduleId
      ? subject.modules.find((m) => m.id === moduleId) || null
      : null;

    if (moduleId && !selectedModule) {
      return NextResponse.json(
        { error: "Selected module not found" },
        { status: 404 },
      );
    }

    const scopedModules = selectedModule ? [selectedModule] : subject.modules;

    const allSubjectNotes = await prisma.note.findMany({
      where: {
        userId: user.id,
        subjectId: subject.id,
        ...(noteIds && noteIds.length > 0 ? { id: { in: noteIds } } : {}),
      },
      select: {
        id: true,
        title: true,
        fileName: true,
        fileType: true,
        filePath: true,
        extractedText: true,
      },
      orderBy: { uploadedAt: "desc" },
      take: noteIds && noteIds.length > 0 ? 6 : 25,
    });

    let notes = allSubjectNotes.slice(0, 3);

    // Strictly scope notes to selectedModule unless the user explicitly passed noteIds
    if (selectedModule && (!noteIds || noteIds.length === 0)) {
      const targetModNum = extractModNum(selectedModule.name);
      const moduleKeywords = new Set([
        ...tokenize(selectedModule.name),
        ...selectedModule.topics.flatMap((t) => tokenize(t.name)),
      ]);

      notes = allSubjectNotes
        .map((n) => {
          const noteHeader = `${n.title} ${n.fileName}`;
          const noteModNum = extractModNum(noteHeader);
          if (targetModNum && noteModNum && noteModNum !== targetModNum) {
            return { note: n, score: -100 };
          }
          let score = 0;
          if (targetModNum && noteModNum && noteModNum === targetModNum) {
            score += 50;
          }
          const noteTokens = new Set(
            tokenize(`${noteHeader} ${(n.extractedText || "").slice(0, 2000)}`),
          );
          for (const kw of moduleKeywords) {
            if (noteTokens.has(kw)) score += 3;
          }
          return { note: n, score };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map((s) => s.note);
    }

    const moduleLines = scopedModules.map((m) => {
      const remaining = m.topics
        .filter((t) => !t.isCompleted)
        .map((t) => t.name);
      const covered = m.topics
        .filter((t) => t.isCompleted)
        .map((t) => t.name);
      return `Module "${m.name}": Remaining=[${remaining.join(", ") || "none"}] | Covered=[${covered.join(", ") || "none"}]`;
    });

    const otherModuleNames = selectedModule
      ? subject.modules
          .filter((m) => m.id !== selectedModule.id)
          .map((m) => m.name)
      : [];

    const hydratedNotes = await Promise.all(
      notes.map(async (n) => {
        const text = await ensureNoteText(n);
        return { ...n, text };
      }),
    );

    const validNotes = hydratedNotes.filter(
      (n): n is typeof n & { text: string } => Boolean(n.text?.trim()),
    );
    const perNoteBudget = Math.max(
      1800,
      Math.floor(5500 / Math.max(1, validNotes.length)),
    );

    const noteContent = validNotes
      .map((n) => `[Note: ${n.title}]\n${n.text.slice(0, perNoteBudget)}`)
      .join("\n\n");

    if (moduleLines.length === 0 && !noteContent) {
      return NextResponse.json(
        {
          error:
            "Upload notes or add modules/topics for this subject first so flashcards have material to draw from.",
        },
        { status: 400 },
      );
    }

    const aiRequest = AI_PROMPTS.generateFlashcards({
      subjectName: subject.name,
      selectedModuleName: selectedModule?.name,
      otherModuleNames,
      count,
      moduleLines,
      noteContent,
    });

    const { content, model } = await callAiChat({
      userId: user.id,
      logFeature: "flashcards_generate",
      signal: request.signal,
      ...aiRequest,
    });

    const aiDeck = extractJsonFromAi<{
      deckTitle?: string;
      cards?: Array<{ front: string; back: string; topicTag?: string }>;
    }>(content);

    const cards = (aiDeck.cards || [])
      .filter((c) => c.front?.trim() && c.back?.trim())
      .slice(0, count);

    if (cards.length === 0) {
      return NextResponse.json(
        { error: "AI returned no usable flashcards" },
        { status: 400 },
      );
    }

    const sourceLabel = selectedModule
      ? notes.length > 0
        ? `${selectedModule.name} • ${notes.map((n) => n.title).join(", ")}`.slice(0, 120)
        : selectedModule.name.slice(0, 120)
      : (notes.length > 0
          ? notes.map((n) => n.title).join(", ")
          : scopedModules.map((m) => m.name).join(", ")
        ).slice(0, 120);

    const deck = await prisma.flashcardDeck.create({
      data: {
        userId: user.id,
        subjectId: subject.id,
        title:
          title?.trim() ||
          aiDeck.deckTitle?.trim() ||
          (selectedModule
            ? `${selectedModule.name} Flashcards`
            : `${subject.name} Flashcards`),
        source: sourceLabel || subject.name,
        cards: {
          create: cards.map((c) => ({
            front: c.front.trim(),
            back: c.back.trim(),
            topicTag: c.topicTag?.trim() || null,
          })),
        },
      },
      include: {
        subject: { select: { id: true, name: true, code: true, color: true } },
        cards: true,
      },
    });

    return NextResponse.json({ deck, model }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to generate flashcards",
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

  const deckId = new URL(request.url).searchParams.get("deckId");
  if (!deckId) {
    return NextResponse.json({ error: "deckId is required" }, { status: 400 });
  }

  await prisma.flashcardDeck.deleteMany({
    where: { id: deckId, userId: user.id },
  });

  return NextResponse.json({ success: true });
}
