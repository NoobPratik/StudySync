import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiUser } from "@/lib/session";
import {
  callAiChatStream,
  ensureNoteText,
  extractJsonFromAi,
  formatMessagesForLog,
  getUserAiConfig,
  recordAiLog,
} from "@/lib/ai";
import { AI_PROMPTS } from "@/lib/ai-prompts";

function normalizeText(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ROMAN_MAP: Record<string, string> = {
  I: "1",
  II: "2",
  III: "3",
  IV: "4",
  V: "5",
  VI: "6",
  VII: "7",
  VIII: "8",
  IX: "9",
  X: "10",
};

function parseNumToken(token: string): string | null {
  const upper = token.trim().toUpperCase();
  if (ROMAN_MAP[upper]) return ROMAN_MAP[upper];
  if (/^\d+$/.test(upper)) return String(Number(upper));
  return null;
}

function extractModuleNumber(name: string): string | null {
  const m = name.match(
    /\b(?:module|unit|chapter|part|mod)\s*[-:#.]?\s*(X|IX|VIII|VII|VI|V|IV|III|II|I|\d+)\b/i,
  );
  if (m) return parseNumToken(m[1]);
  const short = name.match(/\bm\s*[-_]?(\d+)\b/i);
  return short ? String(Number(short[1])) : null;
}

function detectExplicitModuleNumbersInText(text: string): Set<string> {
  const found = new Set<string>();
  const re =
    /\b(?:module|unit|chapter)\s*[-:#.]?\s*(X|IX|VIII|VII|VI|V|IV|III|II|I|\d+)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const num = parseNumToken(match[1]);
    if (num) found.add(num);
  }
  return found;
}

function extractModuleTitleFromDocHead(text: string): string | null {
  const head = text.slice(0, 2500);
  const m = head.match(
    /\b(?:module|unit|chapter)\s*[-:#.]?\s*(?:X|IX|VIII|VII|VI|V|IV|III|II|I|\d+)\s*[-:|]?\s*([^\n]{3,80})/i,
  );
  if (!m) return null;
  const cleaned = m[1].trim().replace(/\s+/g, " ");
  if (/^(contents|table of contents|index|page)$/i.test(cleaned)) return null;
  return cleaned;
}

function formatModuleName(rawName: string, modNumHint: string | null): string {
  const trimmed = rawName.trim().replace(/\s+/g, " ");
  if (!trimmed) return modNumHint ? `Module ${modNumHint}` : "Module 1";

  const hasPrefix =
    /^(module|unit|chapter)\s*(X|IX|VIII|VII|VI|V|IV|III|II|I|\d+)/i.test(
      trimmed,
    );
  if (hasPrefix) {
    return trimmed
      .replace(
        /^(module|unit|chapter)\s*[-:#.]?\s*(X|IX|VIII|VII|VI|V|IV|III|II|I|\d+)\s*[-:|]?\s*/i,
        (_, label, rawNum) => {
          const num = parseNumToken(rawNum) || rawNum;
          return `${label.charAt(0).toUpperCase()}${label.slice(1).toLowerCase()} ${num}: `;
        },
      )
      .replace(/:\s*$/, "");
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
  "problems",
  "problem",
  "practice",
  "method",
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
      (ex.length >= 10 && norm.includes(ex)) ||
      (norm.length >= 10 && ex.includes(norm))
    ) {
      const ratio =
        Math.min(ex.length, norm.length) / Math.max(ex.length, norm.length);
      if (ratio >= 0.72) return true;
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
    const maxSize = Math.max(candTokens.size, exTokens.size);
    if (minSize >= 2 && overlap / minSize >= 0.85 && overlap / maxSize >= 0.65) {
      return true;
    }
  }
  return false;
}

function splitSequentialChunks(
  text: string,
  chunkSize = 6200,
  overlap = 250,
  maxChunks = 14,
): string[] {
  const clean = text.trim();
  if (!clean) return [];
  if (clean.length <= chunkSize + 1500) return [clean];

  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < clean.length && chunks.length < maxChunks) {
    let end = Math.min(clean.length, cursor + chunkSize);

    if (end < clean.length) {
      const windowStart = Math.max(
        cursor + Math.floor(chunkSize * 0.65),
        cursor,
      );
      const slice = clean.slice(windowStart, end);
      const pageBreak = slice.lastIndexOf("\n[Page ");
      const slideBreak = slice.lastIndexOf("\n[Slide ");
      const paraBreak = slice.lastIndexOf("\n\n");
      const lineBreak = slice.lastIndexOf("\n");

      if (pageBreak > 0) end = windowStart + pageBreak;
      else if (slideBreak > 0) end = windowStart + slideBreak;
      else if (paraBreak > 0) end = windowStart + paraBreak;
      else if (lineBreak > 0) end = windowStart + lineBreak;
    }

    const chunk = clean.slice(cursor, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= clean.length) break;

    cursor = Math.max(cursor + 500, end - overlap);
  }

  return chunks;
}

/**
 * Skips pure exercise/practice-problem chunks when a TOC was already seen
 * and the chunk introduces no numbered major section heading.
 */
function isPracticeProblemOnlyChunk(
  chunk: string,
  hasTocInDoc: boolean,
  chunkIndex: number,
): boolean {
  if (!hasTocInDoc || chunkIndex === 0) return false;
  const hasNewSectionHeading =
    /(?:^|\n)\s*\d+\.\s+[A-Z][A-Za-z\s-]{4,60}(?:\n|\.)/m.test(chunk) ||
    /\b(?:module|unit|chapter|definition\s+\d)\b/i.test(chunk);
  if (hasNewSectionHeading) return false;

  const numberedItems = (chunk.match(/(?:^|\n)\s*\(\d+\)\s+/g) || []).length;
  const hasPracticeHeader = /\bpractice\s+problems\b/i.test(chunk);
  return hasPracticeHeader || numberedItems >= 3;
}

export async function POST(request: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const noteId = typeof body.noteId === "string" ? body.noteId : "";
  const targetSubjectId =
    typeof body.subjectId === "string" ? body.subjectId : null;
  const replaceExisting = Boolean(body.replaceExisting);
  const wantStream = Boolean(body.stream);
  const forceThinking =
    typeof body.includeThinking === "boolean" ? body.includeThinking : null;

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

  const [subject, aiConfig] = await Promise.all([
    prisma.subject.findFirst({
      where: { id: subjectId, userId: user.id },
      include: {
        modules: {
          orderBy: { order: "asc" },
          include: { topics: { orderBy: { order: "asc" } } },
        },
      },
    }),
    getUserAiConfig(user.id),
  ]);

  if (!subject) {
    return NextResponse.json({ error: "Subject not found" }, { status: 404 });
  }

  const enableThinking = forceThinking ?? aiConfig.debugMode;

  const runExtraction = async (emit?: (event: string, data: unknown) => void) => {
    const runStartedAt = Date.now();
    const promptTraceBlocks: string[] = [];
    const thinkingTraceBlocks: string[] = [];
    const rawOutputTraceBlocks: string[] = [];
    let lastModel = aiConfig.fastModel?.trim() || aiConfig.model;

    try {
      const text = await ensureNoteText(note, {
        refreshIfLegacyTruncated: true,
      });

      const explicitDocMods = text
        ? detectExplicitModuleNumbersInText(text)
        : new Set<string>();
      const titleModNum =
        extractModuleNumber(note.title) || extractModuleNumber(note.fileName);
      const singleDocModNum =
        explicitDocMods.size === 1 ? Array.from(explicitDocMods)[0] : null;
      const lockedModNum =
        explicitDocMods.size <= 1 ? titleModNum || singleDocModNum : null;

      const docTitleHint = text ? extractModuleTitleFromDocHead(text) : null;
      const lockedModuleName = lockedModNum
        ? formatModuleName(
            docTitleHint || note.title || `Module ${lockedModNum}`,
            lockedModNum,
          )
        : null;

      const hasTocInDoc = Boolean(
        text &&
          /\b(?:contents|table of contents|syllabus)\b/i.test(
            text.slice(0, 3000),
          ),
      );

      const existingSummary =
        subject.modules.length > 0
          ? subject.modules
              .map(
                (m) =>
                  `- id="${m.id}" | name="${m.name}" | existingTopics=[${m.topics.map((t) => `"${t.name}"`).join(", ")}]`,
              )
              .join("\n")
          : "None yet.";

      const chunks = text ? splitSequentialChunks(text) : [];
      const totalPasses = Math.max(1, chunks.length);

      emit?.("meta", {
        noteTitle: note.title,
        totalChunks: totalPasses,
        lockedModuleName,
        model: lastModel,
        debugMode: enableThinking,
      });

interface ExtractedTopicEntry {
  name: string;
  startPage: number | null;
  endPage: number | null;
}

type RawTopicInput =
  | string
  | { name?: string; title?: string; startPage?: unknown; endPage?: unknown };

function normalizeTopicEntry(
  raw: RawTopicInput,
  chunkPageRange?: { min: number | null; max: number | null },
): ExtractedTopicEntry | null {
  if (typeof raw === "string") {
    const name = raw.trim();
    if (!name) return null;
    return {
      name,
      startPage: chunkPageRange?.min ?? null,
      endPage: chunkPageRange?.max ?? null,
    };
  }
  const name = String(raw?.name ?? raw?.title ?? "").trim();
  if (!name) return null;
  const sNum = Number(raw?.startPage);
  const eNum = Number(raw?.endPage);
  const validStart = Number.isFinite(sNum) && sNum >= 1 ? Math.floor(sNum) : null;
  const validEnd = Number.isFinite(eNum) && eNum >= 1 ? Math.floor(eNum) : null;
  const startPage = validStart ?? chunkPageRange?.min ?? null;
  const endPage =
    validEnd !== null && startPage !== null
      ? Math.max(startPage, validEnd)
      : validEnd ?? chunkPageRange?.max ?? startPage;
  return { name, startPage, endPage };
}

function getChunkPageRange(chunk: string): {
  min: number | null;
  max: number | null;
} {
  const nums: number[] = [];
  const re = /\[(?:Page|Slide)\s+(\d+)\]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(chunk)) !== null) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 1) nums.push(n);
  }
  if (nums.length === 0) return { min: null, max: null };
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

      const extractedModulesInOrder: Array<{
        targetModuleId?: string | null;
        name: string;
        topics: ExtractedTopicEntry[];
      }> = [];

      let activeModuleHint: string | null = lockedModuleName;
      const priorTopicsInDoc: string[] = [];

      const runChunkStream = async (
        label: string,
        chunkIdx: number,
        aiRequest: ReturnType<typeof AI_PROMPTS.extractTopics>,
      ) => {
        if (request.signal.aborted) {
          throw new Error("Extraction stopped by user");
        }

        const formattedPrompt = `[${label}]\n${formatMessagesForLog(aiRequest.messages)}`;
        promptTraceBlocks.push(formattedPrompt);

        emit?.("stage", {
          chunkIndex: chunkIdx,
          totalChunks: totalPasses,
          label,
          prompt: formattedPrompt,
        });

        const { content, thinking, model } = await callAiChatStream({
          userId: user.id,
          skipLog: true,
          signal: request.signal,
          ...aiRequest,
          maxThinkingChars: enableThinking ? 5500 : undefined,
          maxTokens: enableThinking ? 1600 : 900,
          onThinking: (txt) => emit?.("thinking", { chunkIndex: chunkIdx, text: txt }),
          onToken: (tok) => emit?.("token", { chunkIndex: chunkIdx, text: tok }),
        });

        lastModel = model;
        if (thinking) thinkingTraceBlocks.push(`[${label}]\n${thinking}`);
        rawOutputTraceBlocks.push(`[${label}]\n${content}`);
        return content;
      };

      if (chunks.length === 0) {
        const sourceContent = `Title: ${note.title}\nFilename: ${note.fileName}\n(No embedded text; infer concise chronological syllabus modules/topics if clear from the title.)`;
        const aiRequest = AI_PROMPTS.extractTopics({
          subjectName: subject.name,
          existingSummary,
          sourceContent,
          lockedModuleName,
          enableThinking,
        });
        const content = await runChunkStream("PASS 1/1", 0, aiRequest);
        const parsed = extractJsonFromAi<{
          modules?: Array<{
            targetModuleId?: string | null;
            name: string;
            topics: RawTopicInput[];
          }>;
        }>(content);
        for (const modEntry of parsed.modules || []) {
          const normalizedTopics = (modEntry.topics || [])
            .map((t) => normalizeTopicEntry(t))
            .filter((t): t is ExtractedTopicEntry => Boolean(t));
          if (normalizedTopics.length === 0) continue;
          extractedModulesInOrder.push({
            targetModuleId: modEntry.targetModuleId,
            name: modEntry.name,
            topics: normalizedTopics,
          });
        }
      } else {
        for (let i = 0; i < chunks.length; i++) {
          if (request.signal.aborted) {
            throw new Error("Extraction stopped by user");
          }

          if (isPracticeProblemOnlyChunk(chunks[i], hasTocInDoc, i)) {
            emit?.("stage", {
              chunkIndex: i,
              totalChunks: totalPasses,
              label: `Chunk ${i + 1}/${totalPasses} — Skipped practice problem pages`,
              skipped: true,
            });
            continue;
          }

          const chunkPages = getChunkPageRange(chunks[i]);
          const sourceContent = `Title: ${note.title}\nFilename: ${note.fileName}\nExcerpt (Chunk ${i + 1}/${chunks.length}):\n${chunks[i]}`;
          const aiRequest = AI_PROMPTS.extractTopics({
            subjectName: subject.name,
            existingSummary,
            sourceContent,
            chunkIndex: i,
            totalChunks: chunks.length,
            lockedModuleName,
            activeModuleHint,
            priorTopicsInDoc,
            hasTocInDoc,
            enableThinking,
          });

          const content = await runChunkStream(
            `Chunk ${i + 1}/${chunks.length}`,
            i,
            aiRequest,
          );

          const parsed = extractJsonFromAi<{
            modules?: Array<{
              targetModuleId?: string | null;
              name: string;
              topics: RawTopicInput[];
            }>;
          }>(content);

          const chunkAdded: string[] = [];
          for (const modEntry of parsed.modules || []) {
            const rawName = (modEntry.name || "").trim();
            const topics = (modEntry.topics || [])
              .map((t) => normalizeTopicEntry(t, chunkPages))
              .filter((t): t is ExtractedTopicEntry => Boolean(t));
            if (topics.length === 0) continue;

            const effectiveName = lockedModuleName || rawName || "Module 1";
            if (!lockedModuleName && rawName) {
              const parsedNum = extractModuleNumber(rawName);
              if (
                parsedNum &&
                explicitDocMods.size > 0 &&
                !explicitDocMods.has(parsedNum)
              ) {
                // Keep activeModuleHint
              } else {
                activeModuleHint = formatModuleName(rawName, parsedNum);
              }
            }

            for (const t of topics) {
              priorTopicsInDoc.push(t.name);
              chunkAdded.push(t.name);
            }
            extractedModulesInOrder.push({
              targetModuleId: lockedModuleName ? null : modEntry.targetModuleId,
              name: activeModuleHint || effectiveName,
              topics,
            });
          }
          emit?.("chunkDone", { chunkIndex: i, addedTopics: chunkAdded });
        }
      }

      const moduleList = subject.modules.map((m) => ({
        id: m.id,
        name: m.name,
        normName: normalizeText(m.name),
        modNum: extractModuleNumber(m.name),
        topicCount: m.topics.length,
        completedNames: new Set(
          m.topics
            .filter((t) => t.isCompleted)
            .map((t) => normalizeText(t.name)),
        ),
        existingTopicsNorm: new Set(m.topics.map((t) => normalizeText(t.name))),
        existingTokenSets: m.topics.map((t) => keyTokens(t.name)),
      }));

      type GroupedBucket = {
        targetMod: (typeof moduleList)[number] | null;
        moduleName: string;
        modNum: string | null;
        topics: ExtractedTopicEntry[];
      };

      const groupedBuckets: GroupedBucket[] = [];

      for (const modData of extractedModulesInOrder) {
        const parsedModNum =
          lockedModNum || extractModuleNumber(modData.name) || titleModNum;
        const modName = formatModuleName(modData.name, parsedModNum);
        const normModName = normalizeText(modName);

        const targetMod =
          (modData.targetModuleId
            ? moduleList.find((m) => m.id === modData.targetModuleId)
            : undefined) ||
          moduleList.find((m) => m.normName === normModName) ||
          (parsedModNum
            ? moduleList.find((m) => m.modNum === parsedModNum)
            : undefined) ||
          null;

        let bucket = groupedBuckets.find(
          (b) =>
            (targetMod && b.targetMod?.id === targetMod.id) ||
            (!targetMod &&
              b.modNum &&
              parsedModNum &&
              b.modNum === parsedModNum) ||
            normalizeText(b.moduleName) === normModName,
        );

        if (!bucket) {
          bucket = {
            targetMod,
            moduleName: targetMod ? targetMod.name : modName,
            modNum: parsedModNum,
            topics: [],
          };
          groupedBuckets.push(bucket);
        }

        for (const t of modData.topics) {
          bucket.topics.push(t);
        }
      }

      for (const bucket of groupedBuckets) {
        const seenLocalNorm = new Set<string>();
        const seenLocalTokens: Set<string>[] = [];
        const preDeduped: ExtractedTopicEntry[] = [];
        for (const tObj of bucket.topics) {
          if (isNearDuplicateTopic(tObj.name, seenLocalNorm, seenLocalTokens))
            continue;
          seenLocalNorm.add(normalizeText(tObj.name));
          seenLocalTokens.push(keyTokens(tObj.name));
          preDeduped.push(tObj);
        }
        bucket.topics = preDeduped;

        if (bucket.topics.length > 16) {
          const consolidateReq = AI_PROMPTS.consolidateTopics({
            subjectName: subject.name,
            moduleName: bucket.moduleName,
            rawTopics: bucket.topics,
            enableThinking: false,
          });
          promptTraceBlocks.push(
            `[CONSOLIDATE "${bucket.moduleName}"]\n${formatMessagesForLog(consolidateReq.messages)}`,
          );
          emit?.("stage", {
            chunkIndex: totalPasses - 1,
            totalChunks: totalPasses,
            label: `Consolidating ${bucket.topics.length} topics into crisp milestones...`,
          });

          try {
            const { content, thinking, model } = await callAiChatStream({
              userId: user.id,
              skipLog: true,
              signal: request.signal,
              ...consolidateReq,
              onToken: (tok) =>
                emit?.("token", { chunkIndex: totalPasses - 1, text: tok }),
            });
            lastModel = model;
            if (thinking) {
              thinkingTraceBlocks.push(
                `[CONSOLIDATE "${bucket.moduleName}"]\n${thinking}`,
              );
            }
            rawOutputTraceBlocks.push(
              `[CONSOLIDATE "${bucket.moduleName}"]\n${content}`,
            );
            const consolidated = extractJsonFromAi<{ topics?: RawTopicInput[] }>(
              content,
            );
            const cleanedList = (consolidated.topics || [])
              .map((t) => normalizeTopicEntry(t))
              .filter((t): t is ExtractedTopicEntry => Boolean(t));
            if (cleanedList.length >= 4) {
              bucket.topics = cleanedList.slice(0, 22);
            }
          } catch (err) {
            if (request.signal.aborted) throw err;
            bucket.topics = bucket.topics.slice(0, 22);
          }
        }
      }

      let createdModulesCount = 0;
      let updatedModulesCount = 0;
      let addedTopicsCount = 0;
      let skippedDuplicatesCount = 0;
      let nextOrder = subject.modules.length;
      const finalParsedSummary: Array<{
        module: string;
        action: string;
        topics: string[];
      }> = [];

      for (const bucket of groupedBuckets) {
        if (bucket.targetMod) {
          const targetMod = bucket.targetMod;
          if (replaceExisting) {
            await prisma.topic.deleteMany({ where: { moduleId: targetMod.id } });
            targetMod.topicCount = 0;
            targetMod.existingTopicsNorm = new Set<string>();
            targetMod.existingTokenSets = [];
          }

          const newTopics: ExtractedTopicEntry[] = [];
          for (const tObj of bucket.topics) {
            if (
              isNearDuplicateTopic(
                tObj.name,
                targetMod.existingTopicsNorm,
                targetMod.existingTokenSets,
              )
            ) {
              skippedDuplicatesCount++;
              continue;
            }
            targetMod.existingTopicsNorm.add(normalizeText(tObj.name));
            targetMod.existingTokenSets.push(keyTokens(tObj.name));
            newTopics.push(tObj);
          }

          if (
            bucket.modNum &&
            !/^(module|unit|chapter)\s*\d+/i.test(targetMod.name)
          ) {
            const upgradedName = formatModuleName(targetMod.name, bucket.modNum);
            await prisma.module.update({
              where: { id: targetMod.id },
              data: { name: upgradedName },
            });
            targetMod.name = upgradedName;
          }

          if (newTopics.length > 0) {
            await prisma.topic.createMany({
              data: newTopics.map((tObj, idx) => {
                const wasDone =
                  replaceExisting &&
                  targetMod.completedNames.has(normalizeText(tObj.name));
                return {
                  moduleId: targetMod.id,
                  name: tObj.name,
                  sourceNoteId: note.id,
                  startPage: tObj.startPage,
                  endPage: tObj.endPage,
                  isCompleted: wasDone,
                  completedAt: wasDone ? new Date() : null,
                  order: targetMod.topicCount + idx,
                };
              }),
            });
            targetMod.topicCount += newTopics.length;
            addedTopicsCount += newTopics.length;
            updatedModulesCount += 1;
          }

          finalParsedSummary.push({
            module: targetMod.name,
            action: replaceExisting ? "rebuilt" : "updated",
            topics: newTopics.map((t) =>
              t.startPage != null
                ? `${t.name} (p.${t.startPage}${t.endPage && t.endPage !== t.startPage ? `-${t.endPage}` : ""})`
                : t.name,
            ),
          });
        } else {
          const uniqueTopics: ExtractedTopicEntry[] = [];
          const seenNorm = new Set<string>();
          const seenTokenSets: Set<string>[] = [];
          for (const tObj of bucket.topics) {
            if (isNearDuplicateTopic(tObj.name, seenNorm, seenTokenSets)) {
              skippedDuplicatesCount++;
              continue;
            }
            seenNorm.add(normalizeText(tObj.name));
            seenTokenSets.push(keyTokens(tObj.name));
            uniqueTopics.push(tObj);
          }

          await prisma.module.create({
            data: {
              subjectId: subject.id,
              name: bucket.moduleName,
              order: nextOrder++,
              topics: {
                create: uniqueTopics.map((tObj, idx) => ({
                  name: tObj.name,
                  sourceNoteId: note.id,
                  startPage: tObj.startPage,
                  endPage: tObj.endPage,
                  order: idx,
                })),
              },
            },
          });

          createdModulesCount += 1;
          addedTopicsCount += uniqueTopics.length;
          finalParsedSummary.push({
            module: bucket.moduleName,
            action: "created",
            topics: uniqueTopics.map((t) =>
              t.startPage != null
                ? `${t.name} (p.${t.startPage}${t.endPage && t.endPage !== t.startPage ? `-${t.endPage}` : ""})`
                : t.name,
            ),
          });
        }
      }

      const debugLogId = await recordAiLog({
        userId: user.id,
        feature: "extract_topics",
        model: lastModel,
        durationMs: Date.now() - runStartedAt,
        status: "SUCCESS",
        inputPrompt: promptTraceBlocks.join("\n\n────────────────────────\n\n"),
        thinking:
          thinkingTraceBlocks.length > 0
            ? thinkingTraceBlocks.join("\n\n────────────────────────\n\n")
            : null,
        rawOutput: rawOutputTraceBlocks.join("\n\n────────────────────────\n\n"),
        parsedOutput: JSON.stringify(
          {
            noteTitle: note.title,
            lockedModuleName,
            chunksProcessed: totalPasses,
            createdModulesCount,
            updatedModulesCount,
            addedTopicsCount,
            skippedDuplicatesCount,
            modules: finalParsedSummary,
          },
          null,
          2,
        ),
      });

      return {
        subjectName: subject.name,
        createdModulesCount,
        updatedModulesCount,
        addedTopicsCount,
        skippedDuplicatesCount,
        chunksProcessed: totalPasses,
        model: lastModel,
        debugLogId,
        modules: finalParsedSummary,
      };
    } catch (err) {
      const wasStopped = request.signal.aborted;
      const errMsg = wasStopped
        ? "Extraction stopped by user"
        : err instanceof Error
          ? err.message
          : "Failed to extract topics from note";

      await recordAiLog({
        userId: user.id,
        feature: "extract_topics",
        model: lastModel,
        durationMs: Date.now() - runStartedAt,
        status: wasStopped ? "STOPPED" : "ERROR",
        inputPrompt:
          promptTraceBlocks.join("\n\n────────────────────────\n\n") ||
          "(no prompt)",
        thinking:
          thinkingTraceBlocks.length > 0
            ? thinkingTraceBlocks.join("\n\n────────────────────────\n\n")
            : null,
        rawOutput:
          rawOutputTraceBlocks.length > 0
            ? rawOutputTraceBlocks.join("\n\n────────────────────────\n\n")
            : null,
        errorMessage: errMsg,
      });

      throw new Error(errMsg);
    }
  };

  if (wantStream) {
    const encoder = new TextEncoder();
    const sseStream = new ReadableStream({
      async start(controller) {
        const sendEvent = (event: string, data: unknown) => {
          if (request.signal.aborted) return;
          try {
            controller.enqueue(
              encoder.encode(
                `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
              ),
            );
          } catch {
            // Stream closed
          }
        };

        try {
          const result = await runExtraction(sendEvent);
          sendEvent("done", result);
        } catch (err) {
          sendEvent("error", {
            error:
              err instanceof Error
                ? err.message
                : "Failed to extract topics from note",
          });
        } finally {
          try {
            controller.close();
          } catch {
            // Already closed
          }
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

  try {
    const result = await runExtraction();
    return NextResponse.json(result);
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
