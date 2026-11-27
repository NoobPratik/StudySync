import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { prisma } from "@/lib/prisma";
import { getApiUser } from "@/lib/session";
import { callAiChat, extractJsonFromAi } from "@/lib/ai";
import { AI_PROMPTS } from "@/lib/ai-prompts";
import { extractTextFromBuffer } from "@/lib/document-parser";

const UPLOAD_ROOT = path.resolve(
  process.cwd(),
  process.env.UPLOAD_DIR || "./uploads",
);

function normalizeText(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractModuleNumber(name: string): string | null {
  const m = name.match(/\b(?:module|unit|chapter|part|mod)\s*[-:#]?\s*(\d+)\b/i);
  if (m) return m[1];
  const short = name.match(/\bm\s*[-_]?(\d+)\b/i);
  return short ? short[1] : null;
}

function formatModuleName(rawName: string, modNumHint: string | null): string {
  const trimmed = rawName.trim().replace(/\s+/g, " ");
  if (!trimmed) return modNumHint ? `Module ${modNumHint}` : "Module 1";

  const hasPrefix = /^(module|unit|chapter)\s*\d+/i.test(trimmed);
  if (hasPrefix) {
    // Normalize separator e.g. "Module 1 - Atomic Structure" -> "Module 1: Atomic Structure"
    return trimmed.replace(
      /^(module|unit|chapter)\s*[-:#]?\s*(\d+)\s*[-:|]?\s*/i,
      (_, label, num) =>
        `${label.charAt(0).toUpperCase()}${label.slice(1).toLowerCase()} ${num}: `,
    ).replace(/:\s*$/, "");
  }

  const num = extractModuleNumber(trimmed) || modNumHint;
  if (num) {
    return `Module ${num}: ${trimmed}`;
  }
  return trimmed;
}

const STOP_WORDS = new Set([
  "and",
  "the",
  "for",
  "with",
  "into",
  "from",
  "using",
  "concepts",
  "introduction",
  "overview",
  "basics",
  "principles",
  "applications",
]);

function keyTokens(str: string): Set<string> {
  return new Set(
    normalizeText(str)
      .split(" ")
      .filter((w) => w.length >= 3 && !STOP_WORDS.has(w)),
  );
}

function isNearDuplicateTopic(
  candidate: string,
  existingNormalized: Set<string>,
  existingTokenSets: Set<string>[],
): boolean {
  const norm = normalizeText(candidate);
  if (!norm) return true;
  if (existingNormalized.has(norm)) return true;

  for (const ex of existingNormalized) {
    if (
      (ex.length >= 8 && norm.includes(ex)) ||
      (norm.length >= 8 && ex.includes(norm))
    ) {
      return true;
    }
  }

  const candTokens = keyTokens(candidate);
  if (candTokens.size === 0) return false;

  for (const exTokens of existingTokenSets) {
    if (exTokens.size === 0) continue;
    let overlap = 0;
    for (const t of candTokens) {
      if (exTokens.has(t)) overlap++;
    }
    const minSize = Math.min(candTokens.size, exTokens.size);
    if (minSize >= 2 && overlap / minSize >= 0.8) {
      return true;
    }
  }
  return false;
}

export async function POST(request: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const noteId = typeof body.noteId === "string" ? body.noteId : "";
    const targetSubjectId =
      typeof body.subjectId === "string" ? body.subjectId : null;

    if (!noteId) {
      return NextResponse.json({ error: "noteId is required" }, { status: 400 });
    }

    const note = await prisma.note.findFirst({
      where: { id: noteId, userId: user.id },
      include: { subject: true },
    });

    if (!note) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    const subjectId = targetSubjectId || note.subjectId;
    if (!subjectId) {
      return NextResponse.json(
        { error: "Assign this note to a Subject before extracting topics." },
        { status: 400 },
      );
    }

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

    let text = note.extractedText;
    if (!text) {
      const fullPath = path.resolve(UPLOAD_ROOT, note.filePath);
      if (fullPath.startsWith(UPLOAD_ROOT)) {
        const buffer = await fs.readFile(fullPath).catch(() => null);
        if (buffer) {
          text = await extractTextFromBuffer(
            buffer,
            note.fileName,
            note.fileType,
          );
          if (text) {
            await prisma.note.update({
              where: { id: note.id },
              data: { extractedText: text },
            });
          }
        }
      }
    }

    const existingSummary =
      subject.modules.length > 0
        ? subject.modules
            .map(
              (m) =>
                `- id="${m.id}" | name="${m.name}" | existingTopics=[${m.topics.map((t) => `"${t.name}"`).join(", ")}]`,
            )
            .join("\n")
        : "None yet.";

    const sourceContent = text
      ? `Title: ${note.title}\nFilename: ${note.fileName}\nContent:\n${text.slice(0, 9000)}`
      : `Title: ${note.title}\nFilename: ${note.fileName}\n(No embedded text; infer concise syllabus modules/topics if clear from the title.)`;

    const aiRequest = AI_PROMPTS.extractTopics({
      subjectName: subject.name,
      existingSummary,
      sourceContent,
    });

    const { content, model } = await callAiChat({
      userId: user.id,
      ...aiRequest,
    });

    const parsed = extractJsonFromAi<{
      modules?: Array<{
        targetModuleId?: string | null;
        name: string;
        topics: string[];
      }>;
    }>(content);

    let createdModulesCount = 0;
    let updatedModulesCount = 0;
    let addedTopicsCount = 0;
    let skippedDuplicatesCount = 0;
    let nextOrder = subject.modules.length;

    // Also inspect note title/filename for explicit Module N hint if AI didn't catch it
    const noteModNumHint =
      extractModuleNumber(note.title) || extractModuleNumber(note.fileName);

    // Maintain mutable cache of existing modules so multiple entries in one response also merge cleanly
    const moduleList = subject.modules.map((m) => ({
      id: m.id,
      name: m.name,
      normName: normalizeText(m.name),
      modNum: extractModuleNumber(m.name),
      topicCount: m.topics.length,
      existingTopicsNorm: new Set(m.topics.map((t) => normalizeText(t.name))),
      existingTokenSets: m.topics.map((t) => keyTokens(t.name)),
    }));

    for (const modData of parsed.modules || []) {
      const rawModName = (modData.name || "").trim();
      if (!rawModName) continue;

      const parsedModNum = extractModuleNumber(rawModName) || noteModNumHint;
      const modName = formatModuleName(rawModName, parsedModNum);
      const normModName = normalizeText(modName);

      // Resolve existing module by explicit targetModuleId, normalized name, or module number
      const targetMod =
        (modData.targetModuleId
          ? moduleList.find((m) => m.id === modData.targetModuleId)
          : undefined) ||
        moduleList.find((m) => m.normName === normModName) ||
        (parsedModNum
          ? moduleList.find((m) => m.modNum === parsedModNum)
          : undefined);

      // Hard cap at 12 core topics per note extraction pass so lists stay clean
      const rawTopics = (modData.topics || [])
        .map((t) => String(t).trim())
        .filter(Boolean)
        .slice(0, 12);

      if (targetMod) {
        const newTopics: string[] = [];
        for (const tName of rawTopics) {
          if (
            isNearDuplicateTopic(
              tName,
              targetMod.existingTopicsNorm,
              targetMod.existingTokenSets,
            )
          ) {
            skippedDuplicatesCount++;
            continue;
          }
          targetMod.existingTopicsNorm.add(normalizeText(tName));
          targetMod.existingTokenSets.push(keyTokens(tName));
          newTopics.push(tName);
        }

        // If the existing module wasn't prefixed with "Module N:" yet and we know it, normalize it cleanly
        if (
          parsedModNum &&
          !/^(module|unit|chapter)\s*\d+/i.test(targetMod.name)
        ) {
          const upgradedName = formatModuleName(targetMod.name, parsedModNum);
          await prisma.module.update({
            where: { id: targetMod.id },
            data: { name: upgradedName },
          });
          targetMod.name = upgradedName;
        }

        if (newTopics.length > 0) {
          await prisma.topic.createMany({
            data: newTopics.map((tName, idx) => ({
              moduleId: targetMod.id,
              name: tName,
              order: targetMod.topicCount + idx,
            })),
          });
          targetMod.topicCount += newTopics.length;
          addedTopicsCount += newTopics.length;
          updatedModulesCount += 1;
        }
      } else {
        const uniqueTopics: string[] = [];
        const seenNorm = new Set<string>();
        const seenTokenSets: Set<string>[] = [];
        for (const tName of rawTopics) {
          if (isNearDuplicateTopic(tName, seenNorm, seenTokenSets)) {
            skippedDuplicatesCount++;
            continue;
          }
          seenNorm.add(normalizeText(tName));
          seenTokenSets.push(keyTokens(tName));
          uniqueTopics.push(tName);
        }

        const created = await prisma.module.create({
          data: {
            subjectId: subject.id,
            name: modName,
            order: nextOrder++,
            topics: {
              create: uniqueTopics.map((t, idx) => ({
                name: t,
                order: idx,
              })),
            },
          },
          include: { topics: true },
        });

        moduleList.push({
          id: created.id,
          name: created.name,
          normName: normalizeText(created.name),
          modNum: extractModuleNumber(created.name),
          topicCount: created.topics.length,
          existingTopicsNorm: seenNorm,
          existingTokenSets: seenTokenSets,
        });

        createdModulesCount += 1;
        addedTopicsCount += uniqueTopics.length;
      }
    }

    return NextResponse.json({
      subjectName: subject.name,
      createdModulesCount,
      updatedModulesCount,
      addedTopicsCount,
      skippedDuplicatesCount,
      model,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to extract topics from note",
      },
      { status: 400 },
    );
  }
}
