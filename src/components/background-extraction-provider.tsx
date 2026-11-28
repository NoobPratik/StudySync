"use client";

import React, {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  useEffect,
} from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Square,
  CheckCircle2,
  AlertCircle,
  X,
  ChevronUp,
  ChevronDown,
  Terminal,
  Wand2,
  Sparkles,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AiLogsDialog } from "@/components/ui/ai-logs-dialog";
import { useElapsedSeconds } from "@/hooks/use-elapsed-timer";
import { readSseStream } from "@/lib/sse-client";
import { cn } from "@/lib/utils";

export interface ExtractionJobRequest {
  noteId: string;
  noteTitle: string;
  subjectId: string;
  subjectName: string;
  replaceExisting?: boolean;
}

interface ActiveExtractionJob {
  noteTitle: string;
  subjectName: string;
  batchIndex: number;
  batchTotal: number;
  status: "running" | "done" | "error" | "stopped";
  stageLabel: string;
  currentChunk: number;
  totalChunks: number;
  discoveredTopics: string[];
  liveThinking: string;
  liveOutput: string;
  livePrompt: string;
  errorText: string | null;
  addedTopicsCount: number;
  debugLogId: string | null;
}

export interface BackgroundAiTask {
  id: string;
  feature: string;
  title: string;
  subtitle: string;
  status: "running" | "done" | "error" | "stopped";
  startedAt: number;
  elapsedSeconds?: number;
  actionLabel?: string;
  actionHref?: string;
  onOpenResult?: () => void;
  errorText?: string | null;
  liveSnippet?: string;
}

export interface StartAiTaskOptions<T> {
  id?: string;
  feature: string;
  title: string;
  subtitle: string;
  actionLabel?: string;
  actionHref?: string;
  run: (signal: AbortSignal) => Promise<T>;
  onComplete?: (result: T) => void;
  onOpenResult?: (result: T) => void;
}

interface BackgroundExtractionContextValue {
  job: ActiveExtractionJob | null;
  isRunning: boolean;
  startExtraction: (req: ExtractionJobRequest) => void;
  startBatchExtraction: (reqs: ExtractionJobRequest[]) => void;
  stopExtraction: () => void;
  dismissJob: () => void;
}

interface BackgroundAiContextValue {
  tasks: BackgroundAiTask[];
  startAiTask: <T>(opts: StartAiTaskOptions<T>) => Promise<T | null>;
  upsertExternalTask: (
    task: Omit<BackgroundAiTask, "startedAt"> & { startedAt?: number },
    abortFn?: () => void,
  ) => void;
  stopAiTask: (id: string) => void;
  dismissAiTask: (id: string) => void;
}

const BackgroundExtractionContext =
  createContext<BackgroundExtractionContextValue | null>(null);
const BackgroundAiContext = createContext<BackgroundAiContextValue | null>(null);

export function useBackgroundExtraction() {
  const ctx = useContext(BackgroundExtractionContext);
  if (!ctx) {
    throw new Error(
      "useBackgroundExtraction must be used inside BackgroundExtractionProvider",
    );
  }
  return ctx;
}

export function useBackgroundAi() {
  const ctx = useContext(BackgroundAiContext);
  if (!ctx) {
    throw new Error(
      "useBackgroundAi must be used inside BackgroundExtractionProvider",
    );
  }
  return ctx;
}

function TaskElapsedBadge({ startedAt }: { startedAt: number }) {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const update = () =>
      setSec(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  return (
    <span className="font-mono text-[10px] text-primary bg-primary/15 border border-primary/30 rounded-full px-1.5 py-0.5 shrink-0">
      {sec}s
    </span>
  );
}

export function BackgroundExtractionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [job, setJob] = useState<ActiveExtractionJob | null>(null);
  const [tasks, setTasks] = useState<BackgroundAiTask[]>([]);
  const [debugMode, setDebugMode] = useState(false);
  const [streamExpanded, setStreamExpanded] = useState(false);
  const [streamTab, setStreamTab] = useState<"thinking" | "output" | "prompt">(
    "thinking",
  );
  const [logsOpen, setLogsOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const taskAbortsRef = useRef<Map<string, () => void>>(new Map());
  const isRunning = job?.status === "running";
  const elapsed = useElapsedSeconds(Boolean(isRunning));

  const syncDebugMode = useCallback(() => {
    fetch("/api/ai/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.config) setDebugMode(Boolean(d.config.debugMode));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    syncDebugMode();
    window.addEventListener("ai-config-updated", syncDebugMode);
    return () => window.removeEventListener("ai-config-updated", syncDebugMode);
  }, [syncDebugMode]);

  const stopExtraction = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const dismissJob = useCallback(() => {
    if (job?.status === "running") return;
    setJob(null);
    setStreamExpanded(false);
  }, [job?.status]);

  const runSingleExtraction = useCallback(
    async (
      req: ExtractionJobRequest,
      batchIndex: number,
      batchTotal: number,
      signal: AbortSignal,
    ): Promise<{ added: number; debugLogId: string | null }> => {
      setJob((prev) => ({
        noteTitle: req.noteTitle,
        subjectName: req.subjectName,
        batchIndex,
        batchTotal,
        status: "running",
        stageLabel:
          batchTotal > 1
            ? `File ${batchIndex}/${batchTotal}: Preparing PDF chunks...`
            : "Preparing PDF chunks...",
        currentChunk: 0,
        totalChunks: 1,
        discoveredTopics: prev?.discoveredTopics && batchIndex > 1 ? prev.discoveredTopics : [],
        liveThinking: "",
        liveOutput: "",
        livePrompt: "",
        errorText: null,
        addedTopicsCount: prev?.addedTopicsCount && batchIndex > 1 ? prev.addedTopicsCount : 0,
        debugLogId: null,
      }));

      const res = await fetch("/api/ai/notes/extract-topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({
          noteId: req.noteId,
          subjectId: req.subjectId,
          replaceExisting: Boolean(req.replaceExisting),
          stream: true,
        }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `Extraction failed for ${req.noteTitle}`);
      }

      let addedCount = 0;
      let debugLogId: string | null = null;

      await readSseStream<
        {
          totalChunks?: number;
          debugMode?: boolean;
          lockedModuleName?: string | null;
        },
        {
          addedTopicsCount?: number;
          chunksProcessed?: number;
          debugLogId?: string | null;
        }
      >(res, {
        onMeta: (meta) => {
          if (meta.debugMode !== undefined) setDebugMode(meta.debugMode);
          setJob((prev) =>
            prev
              ? {
                  ...prev,
                  totalChunks: meta.totalChunks || prev.totalChunks,
                  stageLabel: meta.lockedModuleName
                    ? `${batchTotal > 1 ? `[${batchIndex}/${batchTotal}] ` : ""}Locked to ${meta.lockedModuleName}`
                    : prev.stageLabel,
                }
              : prev,
          );
        },
        onThinking: (txt) => {
          setJob((prev) =>
            prev ? { ...prev, liveThinking: prev.liveThinking + txt } : prev,
          );
        },
        onToken: (tok) => {
          setJob((prev) =>
            prev ? { ...prev, liveOutput: prev.liveOutput + tok } : prev,
          );
        },
        onEvent: (eventName, data) => {
          if (eventName === "stage") {
            const idx = Number(data.chunkIndex ?? 0);
            const total = Number(data.totalChunks ?? 1);
            setJob((prev) =>
              prev
                ? {
                    ...prev,
                    currentChunk: idx + 1,
                    totalChunks: total,
                    stageLabel:
                      typeof data.label === "string"
                        ? `${batchTotal > 1 ? `[${batchIndex}/${batchTotal}] ` : ""}${data.label}`
                        : prev.stageLabel,
                    livePrompt:
                      typeof data.prompt === "string"
                        ? data.prompt
                        : prev.livePrompt,
                    ...(data.skipped
                      ? {}
                      : {
                          liveOutput: "",
                          liveThinking: prev.liveThinking
                            ? `${prev.liveThinking}\n\n─── ${String(data.label || "")} ───\n`
                            : "",
                        }),
                  }
                : prev,
            );
          } else if (eventName === "chunkDone") {
            const added = Array.isArray(data.addedTopics)
              ? (data.addedTopics as string[])
              : [];
            if (added.length > 0) {
              setJob((prev) =>
                prev
                  ? {
                      ...prev,
                      discoveredTopics: [...prev.discoveredTopics, ...added],
                    }
                  : prev,
              );
            }
          }
        },
        onDone: (done) => {
          addedCount = done.addedTopicsCount ?? 0;
          debugLogId = done.debugLogId || null;
        },
      });

      return { added: addedCount, debugLogId };
    },
    [],
  );

  const startBatchExtraction = useCallback(
    async (reqs: ExtractionJobRequest[]) => {
      if (reqs.length === 0) return;
      if (abortRef.current) {
        toast.info("A topic extraction job is already running. Stop it first.");
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;

      let totalAdded = 0;
      let lastDebugLogId: string | null = null;

      try {
        for (let i = 0; i < reqs.length; i++) {
          if (controller.signal.aborted) break;
          const req = reqs[i];
          const res = await runSingleExtraction(
            req,
            i + 1,
            reqs.length,
            controller.signal,
          );
          totalAdded += res.added;
          if (res.debugLogId) lastDebugLogId = res.debugLogId;
          window.dispatchEvent(new CustomEvent("syllabus-updated"));
        }

        const labelSubject =
          reqs.length === 1 ? reqs[0].subjectName : `${reqs.length} files`;
        setJob((prev) =>
          prev
            ? {
                ...prev,
                status: "done",
                currentChunk: prev.totalChunks,
                stageLabel: `Added +${totalAdded} chronological topics`,
                addedTopicsCount: totalAdded,
                debugLogId: lastDebugLogId,
              }
            : prev,
        );
        toast.success(`Extracted +${totalAdded} topics across ${labelSubject}!`);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          setJob((prev) =>
            prev
              ? {
                  ...prev,
                  status: "stopped",
                  stageLabel: "Stopped by user",
                  errorText: "Extraction stopped.",
                }
              : prev,
          );
          toast.info("Topic extraction stopped");
        } else {
          const msg =
            err instanceof Error ? err.message : "Failed to extract topics";
          setJob((prev) =>
            prev
              ? {
                  ...prev,
                  status: "error",
                  stageLabel: "Extraction failed",
                  errorText: msg,
                }
              : prev,
          );
          toast.error(msg);
        }
      } finally {
        abortRef.current = null;
      }
    },
    [runSingleExtraction],
  );

  const startExtraction = useCallback(
    (req: ExtractionJobRequest) => {
      void startBatchExtraction([req]);
    },
    [startBatchExtraction],
  );

  // ── Universal Background AI Task Engine ───────────────────────────────────
  const stopAiTask = useCallback((id: string) => {
    const abort = taskAbortsRef.current.get(id);
    if (abort) abort();
  }, []);

  const dismissAiTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    taskAbortsRef.current.delete(id);
  }, []);

  const upsertExternalTask = useCallback(
    (
      task: Omit<BackgroundAiTask, "startedAt"> & { startedAt?: number },
      abortFn?: () => void,
    ) => {
      if (abortFn) {
        taskAbortsRef.current.set(task.id, abortFn);
      }
      setTasks((prev) => {
        const existing = prev.find((t) => t.id === task.id);
        const startedAt = existing?.startedAt ?? task.startedAt ?? Date.now();
        const elapsedSeconds =
          task.status !== "running"
            ? Math.max(1, Math.round((Date.now() - startedAt) / 1000))
            : undefined;
        const merged: BackgroundAiTask = {
          ...existing,
          ...task,
          startedAt,
          elapsedSeconds: task.elapsedSeconds ?? elapsedSeconds,
        };
        if (existing) {
          return prev.map((t) => (t.id === task.id ? merged : t));
        }
        return [merged, ...prev.slice(0, 3)];
      });
    },
    [],
  );

  const startAiTask = useCallback(
    async <T,>(opts: StartAiTaskOptions<T>): Promise<T | null> => {
      const id =
        opts.id || `${opts.feature}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const ac = new AbortController();
      taskAbortsRef.current.set(id, () => ac.abort());

      const startedAt = Date.now();
      setTasks((prev) => [
        {
          id,
          feature: opts.feature,
          title: opts.title,
          subtitle: opts.subtitle,
          status: "running",
          startedAt,
          actionLabel: opts.actionLabel,
          actionHref: opts.actionHref,
        },
        ...prev.filter((t) => t.id !== id).slice(0, 3),
      ]);

      try {
        const result = await opts.run(ac.signal);
        const elapsedSeconds = Math.max(
          1,
          Math.round((Date.now() - startedAt) / 1000),
        );
        setTasks((prev) =>
          prev.map((t) =>
            t.id === id
              ? {
                  ...t,
                  status: "done",
                  elapsedSeconds,
                  subtitle: `Completed in ${elapsedSeconds}s`,
                  onOpenResult: opts.onOpenResult
                    ? () => opts.onOpenResult!(result)
                    : t.onOpenResult,
                }
              : t,
          ),
        );
        opts.onComplete?.(result);
        window.dispatchEvent(
          new CustomEvent("ai-task-completed", {
            detail: { feature: opts.feature, result },
          }),
        );
        return result;
      } catch (err) {
        const elapsedSeconds = Math.max(
          1,
          Math.round((Date.now() - startedAt) / 1000),
        );
        if (
          (err instanceof DOMException || err instanceof Error) &&
          err.name === "AbortError"
        ) {
          setTasks((prev) =>
            prev.map((t) =>
              t.id === id
                ? {
                    ...t,
                    status: "stopped",
                    elapsedSeconds,
                    subtitle: "Stopped by user",
                  }
                : t,
            ),
          );
          toast.info(`${opts.title} stopped`);
        } else {
          const msg = err instanceof Error ? err.message : "AI task failed";
          setTasks((prev) =>
            prev.map((t) =>
              t.id === id
                ? {
                    ...t,
                    status: "error",
                    elapsedSeconds,
                    subtitle: "Failed",
                    errorText: msg,
                  }
                : t,
            ),
          );
          toast.error(msg);
        }
        return null;
      } finally {
        taskAbortsRef.current.delete(id);
      }
    },
    [],
  );

  const pct =
    job && job.totalChunks > 0
      ? Math.round((job.currentChunk / job.totalChunks) * 100)
      : 0;

  return (
    <BackgroundExtractionContext.Provider
      value={{
        job,
        isRunning: Boolean(isRunning),
        startExtraction,
        startBatchExtraction,
        stopExtraction,
        dismissJob,
      }}
    >
      <BackgroundAiContext.Provider
        value={{
          tasks,
          startAiTask,
          upsertExternalTask,
          stopAiTask,
          dismissAiTask,
        }}
      >
        {children}

        {/* Unified Non-Blocking Floating Background AI Dock */}
        {(job || tasks.length > 0) && (
          <div className="fixed bottom-4 right-4 z-50 w-[375px] max-w-[calc(100vw-2rem)] space-y-2.5 pointer-events-none">
            {/* Active Topic Extraction / Batch Card */}
            {job && (
              <div className="pointer-events-auto rounded-2xl border border-primary/35 bg-[#0c0c1f]/95 backdrop-blur-2xl shadow-2xl overflow-hidden">
                <div className="bg-gradient-to-r from-primary/15 via-secondary/10 to-transparent px-3.5 py-2 border-b border-glass-border/50 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {job.status === "running" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
                    ) : job.status === "done" ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertCircle
                        className={cn(
                          "h-3.5 w-3.5 shrink-0",
                          job.status === "stopped"
                            ? "text-amber-400"
                            : "text-destructive",
                        )}
                      />
                    )}
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-accent truncate">
                      {job.batchTotal > 1
                        ? `Topic Extraction (${job.batchIndex}/${job.batchTotal})`
                        : "Topic Extraction"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {job.status === "running" ? (
                      <>
                        <span className="font-mono text-[10px] text-primary bg-primary/15 border border-primary/30 rounded-full px-1.5 py-0.5">
                          {elapsed}s
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          onClick={stopExtraction}
                          className="h-6 px-2 text-[10px] gap-1"
                        >
                          <Square className="h-2.5 w-2.5 fill-current" />
                          Stop
                        </Button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={dismissJob}
                        className="p-1 rounded-md text-muted-foreground hover:text-foreground cursor-pointer"
                        title="Dismiss"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="p-3.5 space-y-2.5">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-foreground truncate flex items-center gap-1.5">
                      <Wand2 className="h-3 w-3 text-primary shrink-0" />
                      <span className="truncate">{job.noteTitle}</span>
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                      {job.stageLabel}
                    </p>
                  </div>

                  {job.status === "running" && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
                        <span>
                          Chunk {job.currentChunk}/{job.totalChunks}
                        </span>
                        <span>{job.discoveredTopics.length} topics</span>
                      </div>
                      <Progress value={pct} className="h-1.5" />
                    </div>
                  )}

                  {job.errorText && job.status === "error" && (
                    <p className="text-[11px] text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-2.5 py-1.5">
                      {job.errorText}
                    </p>
                  )}

                  <div className="flex items-center justify-between gap-2 pt-0.5">
                    <span className="text-[11px] text-muted-foreground truncate">
                      {job.discoveredTopics.length > 0
                        ? `${job.discoveredTopics.length} topics captured`
                        : "Running in background — browse freely"}
                    </span>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {job.status === "done" && (
                        <button
                          type="button"
                          onClick={() => router.push("/progress")}
                          className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300 hover:bg-emerald-500/25 cursor-pointer"
                        >
                          View Progress <ExternalLink className="h-2.5 w-2.5" />
                        </button>
                      )}
                      {debugMode && (
                        <button
                          type="button"
                          onClick={() => setStreamExpanded((v) => !v)}
                          className="inline-flex items-center gap-1 rounded-md border border-glass-border px-2 py-0.5 text-[10px] text-accent hover:text-primary cursor-pointer"
                        >
                          {streamExpanded ? (
                            <ChevronDown className="h-3 w-3" />
                          ) : (
                            <ChevronUp className="h-3 w-3" />
                          )}
                          Stream
                        </button>
                      )}
                      {debugMode && job.debugLogId && (
                        <button
                          type="button"
                          onClick={() => setLogsOpen(true)}
                          className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/15 px-2 py-0.5 text-[10px] text-primary cursor-pointer"
                        >
                          <Terminal className="h-3 w-3" />
                          Trace
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {debugMode && streamExpanded && (
                  <div className="border-t border-glass-border/70 bg-black/60 p-3 space-y-2">
                    <div className="flex items-center gap-1.5">
                      {(
                        [
                          { id: "thinking", label: "Thinking" },
                          { id: "output", label: "Raw Output" },
                          { id: "prompt", label: "Prompt" },
                        ] as const
                      ).map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setStreamTab(t.id)}
                          className={cn(
                            "px-2 py-0.5 rounded text-[10px] font-medium border cursor-pointer",
                            streamTab === t.id
                              ? "bg-primary/20 border-primary/50 text-primary"
                              : "border-glass-border text-muted-foreground",
                          )}
                        >
                          {t.label}
                        </button>
                      ))}
                      {job.discoveredTopics.length > 0 && (
                        <Badge variant="outline" className="ml-auto text-[10px]">
                          {job.discoveredTopics.length} topics
                        </Badge>
                      )}
                    </div>

                    <pre className="h-52 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-glass-border/50 bg-black/50 p-2.5 text-[11px] font-mono text-foreground/90 leading-relaxed">
                      {streamTab === "thinking"
                        ? job.liveThinking || "(Waiting for thinking tokens...)"
                        : streamTab === "output"
                          ? job.liveOutput || "(Waiting for JSON tokens...)"
                          : job.livePrompt || "(Waiting for chunk prompt...)"}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {/* General AI Generator Task Cards (Flashcards, Mock Exam, Solver, Dashboard, Calendar) */}
            {tasks.map((task) => (
              <div
                key={task.id}
                className="pointer-events-auto rounded-2xl border border-glass-border/90 bg-[#0c0c1f]/95 backdrop-blur-2xl shadow-2xl overflow-hidden"
              >
                <div className="bg-gradient-to-r from-secondary/15 via-primary/10 to-transparent px-3.5 py-2 border-b border-glass-border/50 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {task.status === "running" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
                    ) : task.status === "done" ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertCircle
                        className={cn(
                          "h-3.5 w-3.5 shrink-0",
                          task.status === "stopped"
                            ? "text-amber-400"
                            : "text-destructive",
                        )}
                      />
                    )}
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-accent truncate flex items-center gap-1">
                      <Sparkles className="h-3 w-3 text-primary shrink-0" />
                      {task.title}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {task.status === "running" ? (
                      <>
                        <TaskElapsedBadge startedAt={task.startedAt} />
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          onClick={() => stopAiTask(task.id)}
                          className="h-6 px-2 text-[10px] gap-1"
                        >
                          <Square className="h-2.5 w-2.5 fill-current" />
                          Stop
                        </Button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => dismissAiTask(task.id)}
                        className="p-1 rounded-md text-muted-foreground hover:text-foreground cursor-pointer"
                        title="Dismiss"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="px-3.5 py-2.5 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground truncate">
                      {task.subtitle}
                    </p>
                    {task.status === "done" &&
                      (task.onOpenResult || task.actionHref) && (
                        <button
                          type="button"
                          onClick={() => {
                            if (task.onOpenResult) {
                              task.onOpenResult();
                            } else if (task.actionHref) {
                              router.push(task.actionHref);
                            }
                            dismissAiTask(task.id);
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/25 cursor-pointer shrink-0"
                        >
                          {task.actionLabel || "Open"}
                          <ExternalLink className="h-3 w-3" />
                        </button>
                      )}
                  </div>
                  {task.liveSnippet && task.status === "running" && (
                    <p className="text-[11px] font-mono text-foreground/75 truncate rounded-md bg-black/35 px-2 py-1 border border-glass-border/40">
                      {task.liveSnippet}
                    </p>
                  )}
                  {task.errorText && task.status === "error" && (
                    <p className="text-[11px] text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-2 py-1">
                      {task.errorText}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {debugMode && (
          <AiLogsDialog
            open={logsOpen}
            onOpenChange={setLogsOpen}
            initialLogId={job?.debugLogId}
          />
        )}
      </BackgroundAiContext.Provider>
    </BackgroundExtractionContext.Provider>
  );
}
