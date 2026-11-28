import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getApiUser } from "@/lib/session";
import {
  buildCourseStudyContext,
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

  const mockExams = await prisma.mockExam.findMany({
    where: { userId: user.id },
    include: {
      subject: { select: { id: true, name: true, code: true, color: true } },
      samplePaper: { select: { id: true, title: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ mockExams });
}

const generateMockSchema = z.object({
  subjectId: z.string().min(1, "Please select a subject"),
  moduleId: z.string().optional().nullable(),
  samplePaperId: z.string().optional().nullable(),
  noteIds: z.array(z.string()).optional(),
  totalMarks: z.number().int().min(10).max(200).default(50),
  durationMinutes: z.number().int().min(15).max(240).default(90),
  focusInstructions: z.string().max(1000).optional(),
});

export async function POST(request: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = generateMockSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid mock exam request" },
        { status: 400 },
      );
    }

    const {
      subjectId,
      moduleId,
      samplePaperId,
      noteIds,
      totalMarks,
      durationMinutes,
      focusInstructions,
    } = parsed.data;

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

    const [samplePaper, notes, courseCtx] = await Promise.all([
      samplePaperId
        ? prisma.samplePaper.findFirst({
            where: { id: samplePaperId, userId: user.id },
          })
        : Promise.resolve(null),
      prisma.note.findMany({
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
        take: 4,
      }),
      selectedModule && (!noteIds || noteIds.length === 0)
        ? buildCourseStudyContext({
            userId: user.id,
            query: `${selectedModule.name} ${focusInstructions || ""}`,
            subjectId: subject.id,
            moduleId: selectedModule.id,
            maxMaterialChars: 6000,
          })
        : Promise.resolve(null),
    ]);

    const scopedModules = selectedModule ? [selectedModule] : subject.modules;
    const syllabusSummary = scopedModules
      .map(
        (m) =>
          `${m.name}: ${m.topics.map((t) => t.name).join(", ") || "No topics"}`,
      )
      .join("\n");

    let notesSummary = courseCtx?.materialExcerpts || "";
    if (!notesSummary) {
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
        1600,
        Math.floor(6000 / Math.max(1, validNotes.length)),
      );
      notesSummary = validNotes
        .map((n) => `[Note: ${n.title}]\n${n.text.slice(0, perNoteBudget)}`)
        .join("\n\n");
    }

    if (!syllabusSummary && !notesSummary && !samplePaper) {
      return NextResponse.json(
        {
          error:
            "Add modules/notes or upload a sample PYQ paper for this subject first.",
        },
        { status: 400 },
      );
    }

    const aiRequest = AI_PROMPTS.generateMockExam({
      subjectName: subject.name,
      selectedModuleName: selectedModule?.name,
      totalMarks,
      durationMinutes,
      focusInstructions,
      samplePaperTitle: samplePaper?.title,
      samplePaperText: samplePaper?.extractedText,
      syllabusSummary,
      notesSummary,
    });

    const { content, model } = await callAiChat({
      userId: user.id,
      logFeature: "mock_exam_generate",
      signal: request.signal,
      ...aiRequest,
    });

    const parsedExam = extractJsonFromAi<{
      title?: string;
      totalMarks?: number;
      durationMinutes?: number;
      patternNotes?: string;
      sections?: Array<{
        title: string;
        instructions?: string;
        questions: Array<{
          number: string;
          question: string;
          marks: number;
          type?: string;
          modelAnswer: string;
          markingScheme?: string;
        }>;
      }>;
    }>(content);

    if (!parsedExam.sections || parsedExam.sections.length === 0) {
      return NextResponse.json(
        { error: "AI returned an empty mock exam structure" },
        { status: 400 },
      );
    }

    const exam = await prisma.mockExam.create({
      data: {
        userId: user.id,
        subjectId: subject.id,
        samplePaperId: samplePaper?.id || null,
        title:
          parsedExam.title?.trim() || `${subject.name} Mock Exam`,
        durationMinutes: parsedExam.durationMinutes || durationMinutes,
        totalMarks: parsedExam.totalMarks || totalMarks,
        examContent: JSON.stringify(parsedExam),
      },
      include: {
        subject: { select: { id: true, name: true, code: true, color: true } },
        samplePaper: { select: { id: true, title: true } },
      },
    });

    return NextResponse.json({ mockExam: exam, model }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to generate mock exam",
      },
      { status: 400 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const id = typeof body.id === "string" ? body.id : "";
  const score = typeof body.score === "number" ? body.score : null;

  const existing = await prisma.mockExam.findFirst({
    where: { id, userId: user.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Mock exam not found" }, { status: 404 });
  }

  const updated = await prisma.mockExam.update({
    where: { id },
    data: {
      score,
      completedAt: new Date(),
    },
    include: {
      subject: { select: { id: true, name: true, code: true, color: true } },
      samplePaper: { select: { id: true, title: true } },
    },
  });

  return NextResponse.json({ mockExam: updated });
}

export async function DELETE(request: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  await prisma.mockExam.deleteMany({
    where: { id, userId: user.id },
  });

  return NextResponse.json({ success: true });
}
