"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Plus,
  CheckCircle2,
  Circle,
  Trash2,
  BookOpen,
  Layers,
  CalendarClock,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Loader2,
  CheckCheck,
  ChevronsDownUp,
  ChevronsUpDown,
  Bot,
} from "lucide-react";
import { StudyHeroEmblem, OrbitalIllustration } from "@/components/ui/study-emblem";
import { AiDebugPanel } from "@/components/ui/ai-debug-panel";
import { readSseStream } from "@/lib/sse-client";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { useElapsedSeconds } from "@/hooks/use-elapsed-timer";
import { cn, formatDate } from "@/lib/utils";

interface TopicItem {
  id: string;
  name: string;
  isCompleted: boolean;
}

interface ModuleItem {
  id: string;
  name: string;
  topics: TopicItem[];
}

interface SubjectItem {
  id: string;
  name: string;
  code: string | null;
  semester: string | null;
  color: string;
  modules: ModuleItem[];
}

const SUBJECT_COLORS = [
  "#7C3AED",
  "#6366F1",
  "#EC4899",
  "#10B981",
  "#F59E0B",
  "#06B6D4",
];

export default function ProgressPage() {
  const router = useRouter();
  const [subjects, setSubjects] = useState<SubjectItem[]>([]);
  const [semesterEndDate, setSemesterEndDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedSubjects, setExpandedSubjects] = useState<
    Record<string, boolean>
  >({});
  const [expandedModules, setExpandedModules] = useState<
    Record<string, boolean>
  >({});
  const [topicFilter, setTopicFilter] = useState<
    "ALL" | "REMAINING" | "COMPLETED"
  >("ALL");
  const [nowMs, setNowMs] = useState<number>(0);

  // Subject Modal
  const [subjectModal, setSubjectModal] = useState(false);
  const [subName, setSubName] = useState("");
  const [subCode, setSubCode] = useState("");
  const [subColor, setSubColor] = useState(SUBJECT_COLORS[0]);

  // Module Modal
  const [moduleTargetSubjectId, setModuleTargetSubjectId] = useState<
    string | null
  >(null);
  const [moduleName, setModuleName] = useState("");

  // Topic Modal
  const [topicTargetModuleId, setTopicTargetModuleId] = useState<string | null>(
    null,
  );
  const [topicInput, setTopicInput] = useState("");

  // Target Date Modal
  const [targetModalOpen, setTargetModalOpen] = useState(false);
  const [targetDateInput, setTargetDateInput] = useState("");

  // AI Study Plan Modal
  const [planOpen, setPlanOpen] = useState(false);
  const [planLoading, setPlanLoading] = useState(false);
  const [planContent, setPlanContent] = useState("");
  const [planThinking, setPlanThinking] = useState("");
  const [planDebugMode, setPlanDebugMode] = useState(false);
  const [planModel, setPlanModel] = useState("");
  const planElapsed = useElapsedSeconds(planLoading);

  const syncExpansionDefaults = useCallback((list: SubjectItem[]) => {
    setExpandedSubjects((prev) => {
      const next = { ...prev };
      for (const s of list) {
        if (next[s.id] === undefined) next[s.id] = true;
      }
      return next;
    });
    setExpandedModules((prev) => {
      const next = { ...prev };
      for (const s of list) {
        for (const m of s.modules) {
          if (next[m.id] === undefined) {
            const allDone =
              m.topics.length > 0 && m.topics.every((t) => t.isCompleted);
            // Auto-collapse fully completed modules so active modules stay prominent
            next[m.id] = !allDone;
          }
        }
      }
      return next;
    });
  }, []);

  const loadData = useCallback(async () => {
    try {
      const [sRes, pRes] = await Promise.all([
        fetch("/api/subjects"),
        fetch("/api/profile"),
      ]);
      setNowMs(Date.now());
      if (sRes.ok) {
        const sJson = await sRes.json();
        const list: SubjectItem[] = sJson.subjects || [];
        setSubjects(list);
        syncExpansionDefaults(list);
      }
      if (pRes.ok) {
        const pJson = await pRes.json();
        const end = pJson.profile?.semesterEndDate || null;
        setSemesterEndDate(end);
        if (end) setTargetDateInput(end.slice(0, 10));
      }
    } catch {
      toast.error("Failed to load progress data");
    } finally {
      setLoading(false);
    }
  }, [syncExpansionDefaults]);

  useEffect(() => {
    let active = true;
    Promise.all([fetch("/api/subjects"), fetch("/api/profile")])
      .then(async ([sRes, pRes]) => {
        if (!active) return;
        setNowMs(Date.now());
        if (sRes.ok) {
          const sJson = await sRes.json();
          const list: SubjectItem[] = sJson.subjects || [];
          if (active) {
            setSubjects(list);
            syncExpansionDefaults(list);
          }
        }
        if (pRes.ok) {
          const pJson = await pRes.json();
          const end = pJson.profile?.semesterEndDate || null;
          if (active) {
            setSemesterEndDate(end);
            if (end) setTargetDateInput(end.slice(0, 10));
          }
        }
      })
      .catch(() => {
        if (active) toast.error("Failed to load progress data");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [syncExpansionDefaults]);

  const summary = useMemo(() => {
    let total = 0;
    let completed = 0;
    for (const s of subjects) {
      for (const m of s.modules) {
        for (const t of m.topics) {
          total += 1;
          if (t.isCompleted) completed += 1;
        }
      }
    }
    const remaining = total - completed;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

    let daysLeft: number | null = null;
    let pacePerDay: number | null = null;
    if (semesterEndDate && nowMs > 0) {
      const diff = new Date(semesterEndDate).getTime() - nowMs;
      daysLeft = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
      pacePerDay =
        remaining === 0
          ? 0
          : daysLeft > 0
            ? Number((remaining / daysLeft).toFixed(1))
            : remaining;
    }

    return { total, completed, remaining, percentage, daysLeft, pacePerDay };
  }, [subjects, semesterEndDate, nowMs]);

  async function createSubject(e: React.FormEvent) {
    e.preventDefault();
    if (!subName.trim()) return;
    try {
      const res = await fetch("/api/subjects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: subName.trim(),
          code: subCode.trim() || null,
          color: subColor,
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Subject added");
      setSubjectModal(false);
      setSubName("");
      setSubCode("");
      loadData();
    } catch {
      toast.error("Failed to add subject");
    }
  }

  async function deleteSubject(id: string) {
    try {
      const res = await fetch(`/api/subjects/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Subject deleted");
      loadData();
    } catch {
      toast.error("Failed to delete subject");
    }
  }

  async function createModule(e: React.FormEvent) {
    e.preventDefault();
    if (!moduleTargetSubjectId || !moduleName.trim()) return;
    try {
      const res = await fetch("/api/modules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectId: moduleTargetSubjectId,
          name: moduleName.trim(),
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Module added");
      setModuleTargetSubjectId(null);
      setModuleName("");
      loadData();
    } catch {
      toast.error("Failed to add module");
    }
  }

  async function deleteModule(id: string) {
    try {
      const res = await fetch(`/api/modules/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Module removed");
      loadData();
    } catch {
      toast.error("Failed to delete module");
    }
  }

  async function createTopics(e: React.FormEvent) {
    e.preventDefault();
    if (!topicTargetModuleId) return;
    const lines = topicInput
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return;

    try {
      for (const name of lines) {
        const res = await fetch("/api/topics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ moduleId: topicTargetModuleId, name }),
        });
        if (!res.ok) throw new Error();
      }
      toast.success(
        lines.length === 1 ? "Topic added" : `${lines.length} topics added`,
      );
      setTopicTargetModuleId(null);
      setTopicInput("");
      loadData();
    } catch {
      toast.error("Failed to add topics");
    }
  }

  async function toggleTopic(topic: TopicItem) {
    // Optimistic update for snappy checkbox feedback
    setSubjects((prev) =>
      prev.map((s) => ({
        ...s,
        modules: s.modules.map((m) => ({
          ...m,
          topics: m.topics.map((t) =>
            t.id === topic.id ? { ...t, isCompleted: !t.isCompleted } : t,
          ),
        })),
      })),
    );
    try {
      const res = await fetch(`/api/topics/${topic.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isCompleted: !topic.isCompleted }),
      });
      if (!res.ok) throw new Error();
    } catch {
      toast.error("Failed to update topic");
      loadData();
    }
  }

  async function toggleModuleComplete(mod: ModuleItem) {
    const allDone =
      mod.topics.length > 0 && mod.topics.every((t) => t.isCompleted);
    const nextState = !allDone;

    setSubjects((prev) =>
      prev.map((s) => ({
        ...s,
        modules: s.modules.map((m) =>
          m.id === mod.id
            ? {
                ...m,
                topics: m.topics.map((t) => ({
                  ...t,
                  isCompleted: nextState,
                })),
              }
            : m,
        ),
      })),
    );
    if (nextState) {
      setExpandedModules((p) => ({ ...p, [mod.id]: false }));
    }

    try {
      await Promise.all(
        mod.topics.map((t) =>
          fetch(`/api/topics/${t.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ isCompleted: nextState }),
          }),
        ),
      );
      toast.success(
        nextState ? `Completed "${mod.name}"!` : `Reset "${mod.name}"`,
      );
    } catch {
      toast.error("Failed to update module");
      loadData();
    }
  }

  async function deleteTopic(id: string) {
    try {
      const res = await fetch(`/api/topics/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      loadData();
    } catch {
      toast.error("Failed to delete topic");
    }
  }

  async function saveTargetDate(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          semesterEndDate: targetDateInput || null,
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Target exam date saved");
      setTargetModalOpen(false);
      loadData();
    } catch {
      toast.error("Failed to save target date");
    }
  }

  async function generateStudyPlan() {
    setPlanOpen(true);
    setPlanLoading(true);
    setPlanContent("");
    setPlanThinking("");
    try {
      const res = await fetch("/api/ai/study-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stream: true }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Failed to generate plan");
      }
      await readSseStream<
        { debugMode?: boolean; model?: string },
        { plan?: string; model?: string }
      >(res, {
        onMeta: (meta) => {
          if (meta.debugMode !== undefined) setPlanDebugMode(meta.debugMode);
          if (meta.model) setPlanModel(meta.model);
        },
        onThinking: (txt) => setPlanThinking((p) => p + txt),
        onToken: (tok) => setPlanContent((p) => p + tok),
        onDone: (done) => {
          if (done.plan) setPlanContent(done.plan);
        },
      });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not generate study plan",
      );
      setPlanContent(
        `Error: ${err instanceof Error ? err.message : "Configure AI in Settings first."}`,
      );
    } finally {
      setPlanLoading(false);
    }
  }

  const anySubjectExpanded = useMemo(
    () => subjects.some((s) => expandedSubjects[s.id] ?? true),
    [subjects, expandedSubjects],
  );

  const anyModuleExpanded = useMemo(
    () =>
      subjects.some((s) =>
        s.modules.some((m) => {
          const allDone =
            m.topics.length > 0 && m.topics.every((t) => t.isCompleted);
          return expandedModules[m.id] ?? !allDone;
        }),
      ),
    [subjects, expandedModules],
  );

  function toggleAllSubjects() {
    const nextState = !anySubjectExpanded;
    const next: Record<string, boolean> = {};
    for (const s of subjects) next[s.id] = nextState;
    setExpandedSubjects(next);
  }

  function toggleAllModules() {
    const nextState = !anyModuleExpanded;
    const nextMods: Record<string, boolean> = {};
    for (const s of subjects) {
      for (const m of s.modules) nextMods[m.id] = nextState;
    }
    setExpandedModules(nextMods);
    if (nextState) {
      const nextSubs: Record<string, boolean> = {};
      for (const s of subjects) nextSubs[s.id] = true;
      setExpandedSubjects(nextSubs);
    }
  }

  function explainTopicWithAi(subjectName: string, moduleName: string, topicName: string) {
    const params = new URLSearchParams({
      auto: "1",
      subject: subjectName,
      module: moduleName,
      topic: topicName,
    });
    router.push(`/chat?${params.toString()}`);
  }

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      >
        <div>
          <StudyHeroEmblem icon={BookOpen} eyebrow="Syllabus Mastery" accentColor="violet" />
          <h1 className="text-2xl sm:text-3xl font-bold">
            Syllabus <span className="gradient-text">Progress & Pacing</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Clean collapsible modules with readable checklists and daily pace
            tracking
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={generateStudyPlan}>
            <Sparkles className="h-4 w-4 text-primary" />
            AI Study Plan
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTargetModalOpen(true)}
          >
            <CalendarClock className="h-4 w-4 text-primary" />
            {semesterEndDate
              ? `Target: ${formatDate(semesterEndDate)}`
              : "Set Exam Date"}
          </Button>
          <Button variant="glow" size="sm" onClick={() => setSubjectModal(true)}>
            <Plus className="h-4 w-4" />
            Add Subject
          </Button>
        </div>
      </motion.div>

      {/* Pacing Balance Card */}
      <Card className="gradient-border">
        <CardContent className="pt-0 grid grid-cols-1 md:grid-cols-4 gap-6 items-center">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-accent font-medium">
              <Sparkles className="h-3.5 w-3.5 text-primary" /> Overall Mastery
            </div>
            <p className="text-3xl font-bold">{summary.percentage}%</p>
            <Progress value={summary.percentage} className="mt-2" />
          </div>

          <div>
            <p className="text-xs text-muted-foreground">Topics Covered</p>
            <p className="text-2xl font-bold mt-1">
              {summary.completed}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                / {summary.total}
              </span>
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {summary.remaining} remaining
            </p>
          </div>

          <div>
            <p className="text-xs text-muted-foreground">Days Remaining</p>
            <p className="text-2xl font-bold mt-1">
              {summary.daysLeft !== null ? summary.daysLeft : "—"}
            </p>
            <button
              onClick={() => setTargetModalOpen(true)}
              className="text-xs text-accent hover:text-primary mt-1 cursor-pointer"
            >
              {semesterEndDate ? "Change target date" : "Set target exam date"}
            </button>
          </div>

          <div>
            <p className="text-xs text-muted-foreground">Required Pace</p>
            <p className="text-2xl font-bold mt-1 text-accent">
              {summary.pacePerDay !== null
                ? `${summary.pacePerDay} / day`
                : "Set Date"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              topics per day to finish on time
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Filter & Collapse Toolbar */}
      {subjects.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            {(
              [
                { id: "ALL", label: "All Topics" },
                { id: "REMAINING", label: "Remaining Only" },
                { id: "COMPLETED", label: "Completed Only" },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                onClick={() => setTopicFilter(f.id)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer",
                  topicFilter === f.id
                    ? "bg-primary/20 border-primary/50 text-primary"
                    : "border-glass-border text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={toggleAllSubjects}
            >
              {anySubjectExpanded ? (
                <>
                  <ChevronsDownUp className="h-3.5 w-3.5" /> Collapse Subjects
                </>
              ) : (
                <>
                  <ChevronsUpDown className="h-3.5 w-3.5" /> Expand Subjects
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={toggleAllModules}
            >
              {anyModuleExpanded ? (
                <>
                  <ChevronsDownUp className="h-3.5 w-3.5" /> Collapse Modules
                </>
              ) : (
                <>
                  <ChevronsUpDown className="h-3.5 w-3.5" /> Expand Modules
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Subject List */}
      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-44 rounded-xl shimmer" />
          ))}
        </div>
      ) : subjects.length === 0 ? (
        <Card className="p-12 text-center space-y-3">
          <OrbitalIllustration className="h-24 w-24 mx-auto animate-float" />
          <h3 className="text-lg font-semibold">No subjects created yet</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Add subjects here or in Notes, then click &ldquo;Extract Topics&rdquo;
            on any uploaded PDF/PPT in Notes to auto-build modules!
          </p>
          <Button onClick={() => setSubjectModal(true)}>
            <Plus className="h-4 w-4" /> Add First Subject
          </Button>
        </Card>
      ) : (
        <div className="space-y-4">
          {subjects.map((sub) => {
            let subTotal = 0;
            let subDone = 0;
            for (const m of sub.modules) {
              for (const t of m.topics) {
                subTotal += 1;
                if (t.isCompleted) subDone += 1;
              }
            }
            const subPct =
              subTotal > 0 ? Math.round((subDone / subTotal) * 100) : 0;
            const expanded = expandedSubjects[sub.id] ?? true;

            return (
              <Card key={sub.id} className="overflow-hidden">
                <CardHeader className="pb-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <button
                      onClick={() =>
                        setExpandedSubjects((p) => ({
                          ...p,
                          [sub.id]: !expanded,
                        }))
                      }
                      className="flex items-center gap-3 text-left cursor-pointer"
                    >
                      {expanded ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span
                        className="h-3.5 w-3.5 rounded-full shrink-0"
                        style={{ backgroundColor: sub.color }}
                      />
                      <div>
                        <CardTitle className="text-lg flex items-center gap-2 flex-wrap">
                          {sub.name}
                          {sub.code && (
                            <Badge variant="outline">{sub.code}</Badge>
                          )}
                        </CardTitle>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {sub.modules.length} modules • {subDone}/{subTotal}{" "}
                          topics covered ({subPct}%)
                        </p>
                      </div>
                    </button>

                    <div className="flex items-center gap-2">
                      <div className="w-28 hidden sm:block">
                        <Progress value={subPct} />
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setModuleTargetSubjectId(sub.id)}
                      >
                        <Plus className="h-3.5 w-3.5" /> Module
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => deleteSubject(sub.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                {expanded && (
                  <CardContent className="space-y-3 pt-2 border-t border-glass-border/50">
                    {sub.modules.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-glass-border p-4 text-center text-xs text-muted-foreground">
                        No modules yet. Click &ldquo;+ Module&rdquo; or extract
                        from your uploaded notes!
                      </div>
                    ) : (
                      sub.modules.map((mod) => {
                        const modTotal = mod.topics.length;
                        const modDone = mod.topics.filter(
                          (t) => t.isCompleted,
                        ).length;
                        const modPct =
                          modTotal > 0
                            ? Math.round((modDone / modTotal) * 100)
                            : 0;
                        const isModComplete =
                          modTotal > 0 && modDone === modTotal;
                        const modExpanded = expandedModules[mod.id] ?? true;

                        const visibleTopics = mod.topics.filter((t) => {
                          if (topicFilter === "REMAINING")
                            return !t.isCompleted;
                          if (topicFilter === "COMPLETED")
                            return t.isCompleted;
                          return true;
                        });

                        return (
                          <div
                            key={mod.id}
                            className={cn(
                              "rounded-xl border bg-muted/35 transition-colors",
                              isModComplete
                                ? "border-emerald-500/35 bg-emerald-500/5"
                                : "border-glass-border/70",
                            )}
                          >
                            {/* Collapsible Module Header */}
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3.5">
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedModules((p) => ({
                                    ...p,
                                    [mod.id]: !modExpanded,
                                  }))
                                }
                                className="flex items-center gap-2.5 min-w-0 text-left cursor-pointer flex-1"
                              >
                                {modExpanded ? (
                                  <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                                )}
                                <Layers
                                  className={cn(
                                    "h-4 w-4 shrink-0",
                                    isModComplete
                                      ? "text-emerald-400"
                                      : "text-accent",
                                  )}
                                />
                                <span className="font-semibold text-sm text-foreground break-words">
                                  {mod.name}
                                </span>
                                <Badge
                                  variant={isModComplete ? "success" : "outline"}
                                  className="text-[11px] shrink-0"
                                >
                                  {modDone}/{modTotal} ({modPct}%)
                                </Badge>
                              </button>

                              <div className="flex items-center gap-1.5 shrink-0 pl-6 sm:pl-0">
                                <div className="w-20 hidden md:block mr-1">
                                  <Progress value={modPct} />
                                </div>
                                {modTotal > 0 && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 text-xs"
                                    onClick={() => toggleModuleComplete(mod)}
                                    title={
                                      isModComplete
                                        ? "Mark all unchecked"
                                        : "Mark entire module done"
                                    }
                                  >
                                    <CheckCheck
                                      className={cn(
                                        "h-3.5 w-3.5",
                                        isModComplete && "text-emerald-400",
                                      )}
                                    />
                                    {isModComplete ? "Reset" : "Complete All"}
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-xs"
                                  onClick={() => setTopicTargetModuleId(mod.id)}
                                >
                                  <Plus className="h-3 w-3" /> Topics
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 text-destructive hover:text-destructive"
                                  onClick={() => deleteModule(mod.id)}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>

                            {/* Readable Full-Width Checklist */}
                            {modExpanded && (
                              <div className="px-3.5 pb-3.5 pt-1 border-t border-glass-border/40 space-y-1.5">
                                {visibleTopics.length === 0 ? (
                                  <p className="text-xs text-muted-foreground py-2 pl-6">
                                    {mod.topics.length === 0
                                      ? "No topics yet."
                                      : "No topics match current filter."}
                                  </p>
                                ) : (
                                  visibleTopics.map((topic) => (
                                    <div
                                      key={topic.id}
                                      className={cn(
                                        "flex items-start justify-between gap-3 rounded-lg px-3 py-2.5 border transition-colors group",
                                        topic.isCompleted
                                          ? "bg-emerald-500/5 border-emerald-500/20"
                                          : "bg-background/50 border-glass-border/50 hover:border-primary/40",
                                      )}
                                    >
                                      <button
                                        onClick={() => toggleTopic(topic)}
                                        className="flex items-start gap-3 text-left flex-1 cursor-pointer min-w-0"
                                      >
                                        {topic.isCompleted ? (
                                          <CheckCircle2 className="h-4.5 w-4.5 text-emerald-400 shrink-0 mt-0.5" />
                                        ) : (
                                          <Circle className="h-4.5 w-4.5 text-muted-foreground shrink-0 mt-0.5" />
                                        )}
                                        <span
                                          className={cn(
                                            "text-sm leading-snug break-words",
                                            topic.isCompleted &&
                                              "line-through text-muted-foreground",
                                          )}
                                        >
                                          {topic.name}
                                        </span>
                                      </button>
                                      <div className="flex items-center gap-1 shrink-0 mt-0.5">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            explainTopicWithAi(
                                              sub.name,
                                              mod.name,
                                              topic.name,
                                            )
                                          }
                                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-accent hover:text-primary hover:bg-primary/10 transition-colors cursor-pointer"
                                          title="Explain this topic in detail in AI Tutor"
                                        >
                                          <Bot className="h-3 w-3" />
                                          <span className="hidden sm:inline">Explain</span>
                                        </button>
                                        <button
                                          onClick={() => deleteTopic(topic.id)}
                                          className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-destructive transition-opacity cursor-pointer"
                                          title="Remove topic"
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                      </div>
                                    </div>
                                  ))
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Modals */}
      <Dialog open={subjectModal} onOpenChange={setSubjectModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Subject</DialogTitle>
          </DialogHeader>
          <form onSubmit={createSubject} className="space-y-4">
            <div className="space-y-2">
              <Label>Subject Name</Label>
              <Input
                placeholder="e.g., Linear Algebra and Data Foundations"
                value={subName}
                onChange={(e) => setSubName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Course Code (Optional)</Label>
              <Input
                placeholder="e.g., MA101"
                value={subCode}
                onChange={(e) => setSubCode(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex items-center gap-2">
                {SUBJECT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setSubColor(c)}
                    className={cn(
                      "h-7 w-7 rounded-full border-2 cursor-pointer",
                      subColor === c
                        ? "border-white scale-110"
                        : "border-transparent",
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setSubjectModal(false)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="glow">
                Create Subject
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(moduleTargetSubjectId)}
        onOpenChange={(o) => !o && setModuleTargetSubjectId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Module / Unit</DialogTitle>
          </DialogHeader>
          <form onSubmit={createModule} className="space-y-4">
            <div className="space-y-2">
              <Label>Module Name</Label>
              <Input
                placeholder="e.g., Module 1: Eigenvalues & SVD"
                value={moduleName}
                onChange={(e) => setModuleName(e.target.value)}
                required
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setModuleTargetSubjectId(null)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="glow">
                Add Module
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(topicTargetModuleId)}
        onOpenChange={(o) => !o && setTopicTargetModuleId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Topics</DialogTitle>
            <DialogDescription>
              Enter one topic, or paste multiple lines at once.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={createTopics} className="space-y-4">
            <Textarea
              rows={5}
              placeholder={"Pointers & Arrays\nStructures & Unions\nFile I/O"}
              value={topicInput}
              onChange={(e) => setTopicInput(e.target.value)}
              required
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setTopicTargetModuleId(null)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="glow">
                Add Topics
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={targetModalOpen} onOpenChange={setTargetModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set Target Exam / Semester End Date</DialogTitle>
          </DialogHeader>
          <form onSubmit={saveTargetDate} className="space-y-4">
            <div className="space-y-2">
              <Label>Target Date</Label>
              <Input
                type="date"
                value={targetDateInput}
                onChange={(e) => setTargetDateInput(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setTargetModalOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="glow">
                Save Date
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={planOpen} onOpenChange={setPlanOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              AI Study Balance Plan
            </DialogTitle>
            <DialogDescription>
              Tailored 7-day roadmap based on remaining topics, deadlines, and
              days left.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border border-glass-border bg-muted/40 p-4 min-h-[220px] max-h-[480px] overflow-y-auto space-y-3">
            <AiDebugPanel
              active={planDebugMode}
              loading={planLoading && !planContent}
              elapsedSeconds={planElapsed}
              thinkingText={planThinking}
              model={planModel}
            />
            {planLoading && !planContent ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <span>Balancing topics across remaining days... ({planElapsed}s)</span>
                <span className="text-xs opacity-70">
                  Local models may take 30–120s on 8GB VRAM
                </span>
              </div>
            ) : (
              <MarkdownRenderer content={planContent} />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
