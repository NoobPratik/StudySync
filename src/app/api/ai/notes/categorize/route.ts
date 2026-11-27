import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiUser } from "@/lib/session";
import { callAiChat, extractJsonFromAi } from "@/lib/ai";
import { AI_PROMPTS } from "@/lib/ai-prompts";

export async function POST(request: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const noteIds = Array.isArray(body.noteIds)
      ? (body.noteIds as string[])
      : undefined;

    const [subjects, notes] = await Promise.all([
      prisma.subject.findMany({
        where: { userId: user.id },
        select: { id: true, name: true, code: true },
      }),
      prisma.note.findMany({
        where: {
          userId: user.id,
          ...(noteIds && noteIds.length > 0
            ? { id: { in: noteIds } }
            : { subjectId: null }),
        },
        select: {
          id: true,
          title: true,
          fileName: true,
          extractedText: true,
        },
      }),
    ]);

    if (subjects.length === 0) {
      return NextResponse.json(
        { error: "Create at least one Subject first before auto-categorizing." },
        { status: 400 },
      );
    }

    if (notes.length === 0) {
      return NextResponse.json({ updatedCount: 0, assignments: [] });
    }

    const subjectList = subjects
      .map((s) => `- id="${s.id}" | name="${s.name}"${s.code ? ` | code="${s.code}"` : ""}`)
      .join("\n");

    const notePayload = notes
      .map((n) => ({
        id: n.id,
        title: n.title,
        fileName: n.fileName,
        snippet: (n.extractedText || "").slice(0, 800),
      }));

    const aiRequest = AI_PROMPTS.categorizeNotes({
      subjectList,
      notePayloadJson: JSON.stringify(notePayload),
    });

    const { content } = await callAiChat({
      userId: user.id,
      ...aiRequest,
    });

    const parsed = extractJsonFromAi<{
      assignments?: Array<{ noteId: string; subjectId: string | null }>;
    }>(content);

    const validSubjectIds = new Set(subjects.map((s) => s.id));
    const validNoteIds = new Set(notes.map((n) => n.id));
    let updatedCount = 0;

    for (const item of parsed.assignments || []) {
      if (
        validNoteIds.has(item.noteId) &&
        item.subjectId &&
        validSubjectIds.has(item.subjectId)
      ) {
        await prisma.note.update({
          where: { id: item.noteId },
          data: { subjectId: item.subjectId },
        });
        updatedCount += 1;
      }
    }

    return NextResponse.json({
      updatedCount,
      assignments: parsed.assignments || [],
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to categorize notes",
      },
      { status: 400 },
    );
  }
}
