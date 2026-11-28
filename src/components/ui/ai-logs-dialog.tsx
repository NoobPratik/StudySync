"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import {
  Terminal,
  RefreshCw,
  Trash2,
  Copy,
  Check,
  Clock,
  AlertCircle,
  CheckCircle2,
  StopCircle,
  Brain,
  FileCode2,
  ListChecks,
  MessageSquareCode,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface AiLogRecord {
  id: string;
  feature: string;
  model: string;
  durationMs: number;
  status: string;
  inputPrompt: string;
  thinking: string | null;
  rawOutput: string | null;
  parsedOutput: string | null;
  errorMessage: string | null;
  createdAt: string;
}

interface ParsedExtractionPayload {
  noteTitle?: string;
  lockedModuleName?: string | null;
  chunksProcessed?: number;
  addedTopicsCount?: number;
  skippedDuplicatesCount?: number;
  modules?: Array<{
    module: string;
    action: string;
    topics: string[];
  }>;
}

function tryParseExtraction(raw: string | null): ParsedExtractionPayload | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as ParsedExtractionPayload;
    if (obj && Array.isArray(obj.modules)) return obj;
    return null;
  } catch {
    return null;
  }
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(`Copied ${label}`);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copy failed");
    }
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={handleCopy}
      className="h-7 px-2.5 text-[11px] gap-1.5"
    >
      {copied ? (
        <Check className="h-3 w-3 text-emerald-400" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
      {copied ? "Copied" : `Copy ${label}`}
    </Button>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "ERROR") {
    return (
      <Badge variant="destructive" className="text-[10px] gap-1">
        <AlertCircle className="h-3 w-3" />
        Error
      </Badge>
    );
  }
  if (status === "STOPPED") {
    return (
      <Badge
        variant="outline"
        className="text-[10px] gap-1 border-amber-500/40 text-amber-400 bg-amber-500/10"
      >
        <StopCircle className="h-3 w-3" />
        Stopped
      </Badge>
    );
  }
  return (
    <Badge variant="success" className="text-[10px] gap-1">
      <CheckCircle2 className="h-3 w-3" />
      Success
    </Badge>
  );
}

export function AiLogsDialog({
  open,
  onOpenChange,
  initialLogId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialLogId?: string | null;
}) {
  const [logs, setLogs] = useState<AiLogRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialLogId || null,
  );
  const [filter, setFilter] = useState<"ALL" | "EXTRACT" | "CHAT" | "ISSUES">(
    "ALL",
  );
  const [activeTab, setActiveTab] = useState<
    "parsed" | "thinking" | "raw" | "prompt"
  >("parsed");

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ai/logs");
      if (res.ok) {
        const json = await res.json();
        const list: AiLogRecord[] = json.logs || [];
        setLogs(list);
        setSelectedId((prev) => {
          if (initialLogId && list.some((l) => l.id === initialLogId)) {
            return initialLogId;
          }
          if (prev && list.some((l) => l.id === prev)) return prev;
          return list[0]?.id || null;
        });
      }
    } catch {
      toast.error("Failed to fetch AI debug logs");
    } finally {
      setLoading(false);
    }
  }, [initialLogId]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      loadLogs();
    }, 0);
    return () => clearTimeout(t);
  }, [open, loadLogs]);

  const filteredLogs = useMemo(() => {
    return logs.filter((l) => {
      if (filter === "EXTRACT") return l.feature.includes("extract");
      if (filter === "CHAT") return l.feature.startsWith("chat_");
      if (filter === "ISSUES") return l.status !== "SUCCESS";
      return true;
    });
  }, [logs, filter]);

  const selectedLog = useMemo(
    () =>
      filteredLogs.find((l) => l.id === selectedId) ||
      filteredLogs[0] ||
      null,
    [filteredLogs, selectedId],
  );

  // Auto-select available tab when switching logs
  const effectiveTab = useMemo(() => {
    if (!selectedLog) return "prompt";
    if (activeTab === "parsed" && !selectedLog.parsedOutput) {
      return selectedLog.thinking ? "thinking" : "raw";
    }
    return activeTab;
  }, [selectedLog, activeTab]);

  const parsedExtraction = useMemo(
    () =>
      selectedLog?.feature === "extract_topics"
        ? tryParseExtraction(selectedLog.parsedOutput)
        : null,
    [selectedLog],
  );

  async function clearLogs() {
    try {
      const res = await fetch("/api/ai/logs", { method: "DELETE" });
      if (!res.ok) throw new Error();
      setLogs([]);
      setSelectedId(null);
      toast.success("AI debug logs cleared");
    } catch {
      toast.error("Failed to clear logs");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-6xl h-[88vh] p-0 overflow-hidden flex flex-col gap-0 bg-[#0c0c1d]/98 border border-glass-border shadow-2xl">
        {/* Top Header */}
        <DialogHeader className="px-6 py-4 pr-14 border-b border-glass-border/70 bg-muted/30 shrink-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
                <div className="h-7 w-7 rounded-lg bg-primary/20 flex items-center justify-center">
                  <Terminal className="h-4 w-4 text-primary" />
                </div>
                AI Trace Inspector
              </DialogTitle>
              <DialogDescription className="text-xs">
                Inspect exact prompts, live thinking traces, raw responses, and
                parsed modules/topics for every AI run.
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={loadLogs}
                disabled={loading}
                className="h-8 text-xs"
              >
                <RefreshCw
                  className={cn("h-3.5 w-3.5", loading && "animate-spin")}
                />
                Refresh
              </Button>
              {logs.length > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={clearLogs}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Clear All
                </Button>
              )}
            </div>
          </div>
        </DialogHeader>

        {/* Master-Detail Body */}
        <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
          {/* Left Pane: Run History */}
          <div className="w-full md:w-[310px] lg:w-[340px] shrink-0 border-b md:border-b-0 md:border-r border-glass-border/60 bg-muted/15 flex flex-col min-h-[180px] max-h-[34vh] md:max-h-none">
            <div className="p-3 border-b border-glass-border/50 flex items-center gap-1.5 flex-wrap">
              {(
                [
                  { id: "ALL", label: "All" },
                  { id: "EXTRACT", label: "Extraction" },
                  { id: "CHAT", label: "Tutor" },
                  { id: "ISSUES", label: "Issues" },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  className={cn(
                    "px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors cursor-pointer",
                    filter === f.id
                      ? "bg-primary/20 border-primary/50 text-primary"
                      : "border-glass-border/60 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {loading && logs.length === 0 ? (
                <div className="space-y-2">
                  <div className="h-16 rounded-xl shimmer" />
                  <div className="h-16 rounded-xl shimmer" />
                </div>
              ) : filteredLogs.length === 0 ? (
                <div className="rounded-xl border border-dashed border-glass-border p-6 text-center text-xs text-muted-foreground">
                  No logs matching filter.
                </div>
              ) : (
                filteredLogs.map((log) => {
                  const isActive = selectedLog?.id === log.id;
                  return (
                    <button
                      key={log.id}
                      type="button"
                      onClick={() => setSelectedId(log.id)}
                      className={cn(
                        "w-full text-left rounded-xl border p-3 transition-all cursor-pointer space-y-1.5",
                        isActive
                          ? "bg-primary/15 border-primary/50 shadow-[0_0_16px_rgba(124,58,237,0.15)]"
                          : "bg-background/40 border-glass-border/50 hover:border-primary/30 hover:bg-muted/40",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className={cn(
                              "h-2 w-2 rounded-full shrink-0",
                              log.status === "ERROR"
                                ? "bg-destructive"
                                : log.status === "STOPPED"
                                  ? "bg-amber-400"
                                  : "bg-emerald-400",
                            )}
                          />
                          <span className="text-xs font-semibold font-mono truncate text-foreground">
                            {log.feature}
                          </span>
                        </div>
                        <span className="text-[11px] font-mono text-muted-foreground shrink-0">
                          {(log.durationMs / 1000).toFixed(1)}s
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                        <span className="truncate">{log.model}</span>
                        <span className="shrink-0">
                          {new Date(log.createdAt).toLocaleTimeString()}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 flex-wrap">
                        {log.thinking && (
                          <Badge
                            variant="outline"
                            className="text-[10px] py-0 px-1.5 border-primary/35 text-accent"
                          >
                            thinking {log.thinking.length}c
                          </Badge>
                        )}
                        {log.parsedOutput && (
                          <Badge
                            variant="outline"
                            className="text-[10px] py-0 px-1.5 border-emerald-500/35 text-emerald-400"
                          >
                            parsed
                          </Badge>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Pane: Run Detail Inspector */}
          <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-background/50">
            {!selectedLog ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-2 text-muted-foreground">
                <Sparkles className="h-8 w-8 text-primary/60" />
                <p className="text-sm font-medium text-foreground">
                  Select an AI run to inspect
                </p>
                <p className="text-xs max-w-sm">
                  Every extraction and tutor call records its input prompt,
                  thinking trace, raw model output, and parsed results here.
                </p>
              </div>
            ) : (
              <>
                {/* Run Summary + Tabs */}
                <div className="px-5 py-4 border-b border-glass-border/60 space-y-3 shrink-0 bg-muted/10">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <StatusBadge status={selectedLog.status} />
                      <Badge variant="outline" className="font-mono text-[11px]">
                        {selectedLog.feature}
                      </Badge>
                      <span className="text-xs font-medium text-foreground">
                        {selectedLog.model}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1 font-mono">
                        <Clock className="h-3.5 w-3.5" />
                        {(selectedLog.durationMs / 1000).toFixed(2)}s
                      </span>
                      <span>
                        {new Date(selectedLog.createdAt).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {selectedLog.errorMessage && (
                    <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                      {selectedLog.errorMessage}
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {(
                        [
                          {
                            id: "parsed",
                            label: "Parsed Output",
                            icon: ListChecks,
                            show: Boolean(selectedLog.parsedOutput),
                          },
                          {
                            id: "thinking",
                            label: `Thinking (${selectedLog.thinking?.length || 0})`,
                            icon: Brain,
                            show: true,
                          },
                          {
                            id: "raw",
                            label: `Raw Output (${selectedLog.rawOutput?.length || 0})`,
                            icon: FileCode2,
                            show: true,
                          },
                          {
                            id: "prompt",
                            label: `Input Prompt (${selectedLog.inputPrompt.length})`,
                            icon: MessageSquareCode,
                            show: true,
                          },
                        ] as const
                      )
                        .filter((t) => t.show)
                        .map((tab) => {
                          const Icon = tab.icon;
                          return (
                            <button
                              key={tab.id}
                              type="button"
                              onClick={() => setActiveTab(tab.id)}
                              className={cn(
                                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer",
                                effectiveTab === tab.id
                                  ? "bg-primary/20 border-primary/50 text-primary"
                                  : "border-glass-border/70 text-muted-foreground hover:text-foreground",
                              )}
                            >
                              <Icon className="h-3.5 w-3.5" />
                              {tab.label}
                            </button>
                          );
                        })}
                    </div>

                    <CopyButton
                      label={effectiveTab}
                      text={
                        effectiveTab === "parsed"
                          ? selectedLog.parsedOutput || ""
                          : effectiveTab === "thinking"
                            ? selectedLog.thinking || ""
                            : effectiveTab === "raw"
                              ? selectedLog.rawOutput || ""
                              : selectedLog.inputPrompt
                      }
                    />
                  </div>
                </div>

                {/* Tab Content */}
                <div className="flex-1 min-h-0 overflow-y-auto p-5">
                  {effectiveTab === "parsed" && parsedExtraction ? (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="rounded-xl border border-glass-border/60 bg-muted/25 p-3">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            PDF / Note
                          </p>
                          <p className="text-xs font-semibold mt-1 truncate">
                            {parsedExtraction.noteTitle || "—"}
                          </p>
                        </div>
                        <div className="rounded-xl border border-glass-border/60 bg-muted/25 p-3">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            Locked Module
                          </p>
                          <p className="text-xs font-semibold mt-1 truncate">
                            {parsedExtraction.lockedModuleName || "Multi-Module"}
                          </p>
                        </div>
                        <div className="rounded-xl border border-glass-border/60 bg-muted/25 p-3">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            Chunks Scanned
                          </p>
                          <p className="text-sm font-bold mt-1">
                            {parsedExtraction.chunksProcessed ?? 1}
                          </p>
                        </div>
                        <div className="rounded-xl border border-glass-border/60 bg-muted/25 p-3">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            Topics Added
                          </p>
                          <p className="text-sm font-bold text-emerald-400 mt-1">
                            +{parsedExtraction.addedTopicsCount ?? 0}
                          </p>
                        </div>
                      </div>

                      {parsedExtraction.modules?.map((m, mIdx) => (
                        <div
                          key={mIdx}
                          className="rounded-xl border border-glass-border/70 bg-muted/20 p-4 space-y-2.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-foreground">
                              {m.module}
                            </p>
                            <Badge variant="outline" className="text-[10px]">
                              {m.action} • {m.topics.length} topics
                            </Badge>
                          </div>
                          <ol className="space-y-1.5 pl-1">
                            {m.topics.map((topic, tIdx) => (
                              <li
                                key={tIdx}
                                className="flex items-center gap-2 text-xs text-foreground/90 rounded-lg bg-background/50 px-3 py-1.5 border border-glass-border/40"
                              >
                                <span className="font-mono text-[11px] text-primary w-5 shrink-0">
                                  {tIdx + 1}.
                                </span>
                                <span>{topic}</span>
                              </li>
                            ))}
                          </ol>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <pre className="whitespace-pre-wrap break-words rounded-xl border border-glass-border/60 bg-black/50 p-4 text-xs font-mono text-foreground/90 leading-relaxed">
                      {effectiveTab === "parsed"
                        ? selectedLog.parsedOutput || "(No parsed output)"
                        : effectiveTab === "thinking"
                          ? selectedLog.thinking ||
                            "(No thinking tokens captured for this run. Enable 'AI Debug Mode' in Settings or toggle thinking during extraction.)"
                          : effectiveTab === "raw"
                            ? selectedLog.rawOutput || "(Empty raw output)"
                            : selectedLog.inputPrompt}
                    </pre>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AiLogsButton({
  className,
  size = "sm",
  variant = "outline",
  label = "AI Logs",
  forceVisible,
}: {
  className?: string;
  size?: "sm" | "default" | "icon";
  variant?: "outline" | "ghost" | "default";
  label?: string;
  forceVisible?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [debugEnabled, setDebugEnabled] = useState(false);

  useEffect(() => {
    let active = true;
    const check = () => {
      fetch("/api/ai/config")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (active && d?.config) setDebugEnabled(Boolean(d.config.debugMode));
        })
        .catch(() => {});
    };
    check();
    window.addEventListener("ai-config-updated", check);
    return () => {
      active = false;
      window.removeEventListener("ai-config-updated", check);
    };
  }, []);

  const visible = forceVisible !== undefined ? forceVisible : debugEnabled;
  if (!visible) return null;

  return (
    <>
      <Button
        type="button"
        size={size}
        variant={variant}
        onClick={() => setOpen(true)}
        className={className}
        title="Inspect AI Input Prompts, Thinking & Raw Outputs"
      >
        <Terminal className="h-3.5 w-3.5 text-primary" />
        {size !== "icon" && <span>{label}</span>}
      </Button>
      <AiLogsDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
