"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import { format } from "date-fns";
import {
  Plus,
  Target,
  CheckCircle2,
  Circle,
  Clock,
  Trash2,
  Edit2,
  AlertTriangle,
  MessageSquareText,
  Sparkles,
  Upload,
  Loader2,
  FileText,
  CalendarPlus,
  Globe,
  Copy,
  Check,
  Square,
  Brain,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { StudyHeroEmblem } from "@/components/ui/study-emblem";
import { AiDebugPanel } from "@/components/ui/ai-debug-panel";
import { AiLogsButton } from "@/components/ui/ai-logs-dialog";
import { useBackgroundAi } from "@/components/background-extraction-provider";
import { useElapsedSeconds } from "@/hooks/use-elapsed-timer";
import { readSseStream } from "@/lib/sse-client";
import {
  cn,
  formatDateTime,
  formatRelativeTime,
  getDeadlineColor,
  getPriorityColor,
} from "@/lib/utils";

interface SubjectOption {
  id: string;
  name: string;
  code: string | null;
  color: string;
}

interface DeadlineItem {
  id: string;
  title: string;
  description: string | null;
  questions: string | null;
  aiAnswer: string | null;
  aiAnswerMode: string | null;
  aiSources: string | null;
  deadlineType:
    | "ASSIGNMENT"
    | "LAB_EXAM"
    | "TEST"
    | "MID_SEM"
    | "END_SEM"
    | "PROJECT"
    | "OTHER";
  dueAt: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED";
  subjectId: string | null;
  subject: SubjectOption | null;
}

interface ExtractedDeadline {
  title: string;
  description?: string;
  deadlineType?: string;
  dueAt: string;
  priority?: string;
  subjectId?: string | null;
  writeupHint?: string;
  selected?: boolean;
}

interface ExtractedEvent {
  title: string;
  eventType?: string;
  startAt: string;
  endAt: string;
  location?: string | null;
  description?: string | null;
  selected?: boolean;
}

interface ExtractedMaterial {
  name: string;
  subject?: string;
  context?: string;
}

interface WebSource {
  title: string;
  url: string;
}

const DEADLINE_TYPES = [
  { value: "ASSIGNMENT", label: "Assignment" },
  { value: "LAB_EXAM", label: "Lab Exam" },
  { value: "TEST", label: "Unit Test / Quiz" },
  { value: "MID_SEM", label: "Mid-Sem Exam" },
  { value: "END_SEM", label: "End-Sem Exam" },
  { value: "PROJECT", label: "Group Project" },
  { value: "OTHER", label: "Other" },
];

export default function DeadlinesPage() {
  const [deadlines, setDeadlines] = useState<DeadlineItem[]>([]);
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [statusFilter, setStatusFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DeadlineItem | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Deadline form
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [questions, setQuestions] = useState("");
  const [deadlineType, setDeadlineType] =
    useState<DeadlineItem["deadlineType"]>("ASSIGNMENT");
  const [dueDate, setDueDate] = useState(() =>
    format(new Date(Date.now() + 86400000), "yyyy-MM-dd"),
  );
  const [dueTime, setDueTime] = useState("23:59");
  const [priority, setPriority] = useState<DeadlineItem["priority"]>("MEDIUM");
  const [status, setStatus] = useState<DeadlineItem["status"]>("PENDING");
  const [subjectId, setSubjectId] = useState("NONE");

  // WhatsApp Import Modal
  const waFileRef = useRef<HTMLInputElement>(null);
  const waAbortRef = useRef<AbortController | null>(null);
  const [waOpen, setWaOpen] = useState(false);
  const [waText, setWaText] = useState("");
  const [waFile, setWaFile] = useState<File | null>(null);
  const [waParsing, setWaParsing] = useState(false);
  const [waDeadlines, setWaDeadlines] = useState<ExtractedDeadline[]>([]);
  const [waEvents, setWaEvents] = useState<ExtractedEvent[]>([]);
  const [waMaterials, setWaMaterials] = useState<ExtractedMaterial[]>([]);
  const [waImporting, setWaImporting] = useState(false);

  // AI Assignment Answer Solver Modal
  const assignFileRef = useRef<HTMLInputElement>(null);
  const solverAbortRef = useRef<AbortController | null>(null);
  const [helperTarget, setHelperTarget] = useState<DeadlineItem | null>(null);
  const [helperMode, setHelperMode] = useState<
    "answer" | "project_report" | "viva_prep"
  >("answer");
  const [solverQuestions, setSolverQuestions] = useState("");
  const [solverFile, setSolverFile] = useState<File | null>(null);
  const [useWebSearch, setUseWebSearch] = useState(true);
  const [helperThink, setHelperThink] = useState(true);
  const [helperLoading, setHelperLoading] = useState(false);
  const [helperAnswer, setHelperAnswer] = useState("");
  const [helperThinking, setHelperThinking] = useState("");
  const [helperPromptText, setHelperPromptText] = useState("");
  const [helperDebugMode, setHelperDebugMode] = useState(false);
  const [helperModel, setHelperModel] = useState("");
  const [helperSources, setHelperSources] = useState<WebSource[]>([]);
  const [helperNotes, setHelperNotes] = useState<Array<{ title: string }>>([]);
  const [copied, setCopied] = useState(false);

  const aiElapsed = useElapsedSeconds(helperLoading || waParsing);
  const { upsertExternalTask } = useBackgroundAi();

  const loadData = useCallback(async () => {
    try {
      const [dRes, sRes] = await Promise.all([
        fetch("/api/deadlines"),
        fetch("/api/subjects"),
      ]);
      if (dRes.ok) {
        const dJson = await dRes.json();
        setDeadlines(dJson.deadlines || []);
      }
      if (sRes.ok) {
        const sJson = await sRes.json();
        setSubjects(sJson.subjects || []);
      }
    } catch {
      toast.error("Failed to load deadlines");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([fetch("/api/deadlines"), fetch("/api/subjects")])
      .then(async ([dRes, sRes]) => {
        if (!active) return;
        if (dRes.ok) {
          const dJson = await dRes.json();
          if (active) setDeadlines(dJson.deadlines || []);
        }
        if (sRes.ok) {
          const sJson = await sRes.json();
          if (active) setSubjects(sJson.subjects || []);
        }
      })
      .catch(() => {
        if (active) toast.error("Failed to load deadlines");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const filteredDeadlines = useMemo(() => {
    return deadlines.filter((d) => {
      if (statusFilter === "OVERDUE") {
        if (d.status === "COMPLETED") return false;
        if (new Date(d.dueAt) >= new Date()) return false;
      } else if (statusFilter !== "ALL" && d.status !== statusFilter) {
        return false;
      }
      if (typeFilter !== "ALL" && d.deadlineType !== typeFilter) return false;
      return true;
    });
  }, [deadlines, statusFilter, typeFilter]);

  const counts = useMemo(() => {
    const now = new Date();
    return {
      all: deadlines.length,
      pending: deadlines.filter((d) => d.status === "PENDING").length,
      inProgress: deadlines.filter((d) => d.status === "IN_PROGRESS").length,
      completed: deadlines.filter((d) => d.status === "COMPLETED").length,
      overdue: deadlines.filter(
        (d) => d.status !== "COMPLETED" && new Date(d.dueAt) < now,
      ).length,
    };
  }, [deadlines]);

  function openNew() {
    setEditing(null);
    setTitle("");
    setDescription("");
    setQuestions("");
    setDeadlineType("ASSIGNMENT");
    setDueDate(format(new Date(Date.now() + 86400000), "yyyy-MM-dd"));
    setDueTime("23:59");
    setPriority("MEDIUM");
    setStatus("PENDING");
    setSubjectId("NONE");
    setDialogOpen(true);
  }

  function openEdit(item: DeadlineItem) {
    const dt = new Date(item.dueAt);
    setEditing(item);
    setTitle(item.title);
    setDescription(item.description || "");
    setQuestions(item.questions || "");
    setDeadlineType(item.deadlineType);
    setDueDate(format(dt, "yyyy-MM-dd"));
    setDueTime(format(dt, "HH:mm"));
    setPriority(item.priority);
    setStatus(item.status);
    setSubjectId(item.subjectId || "NONE");
    setDialogOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Please enter a deadline title");
      return;
    }

    const dueAt = new Date(`${dueDate}T${dueTime}:00`);
    setSubmitting(true);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        questions: questions.trim() || null,
        deadlineType,
        dueAt: dueAt.toISOString(),
        priority,
        status,
        subjectId: subjectId === "NONE" ? null : subjectId,
      };

      const res = await fetch(
        editing ? `/api/deadlines/${editing.id}` : "/api/deadlines",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) throw new Error();
      toast.success(editing ? "Deadline updated" : "Deadline created");
      setDialogOpen(false);
      loadData();
    } catch {
      toast.error("Failed to save deadline");
    } finally {
      setSubmitting(false);
    }
  }

  async function cycleStatus(item: DeadlineItem) {
    const order: DeadlineItem["status"][] = [
      "PENDING",
      "IN_PROGRESS",
      "COMPLETED",
    ];
    const next = order[(order.indexOf(item.status) + 1) % order.length];
    try {
      const res = await fetch(`/api/deadlines/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error();
      toast.success(`Marked as ${next.replace("_", " ").toLowerCase()}`);
      loadData();
    } catch {
      toast.error("Failed to update status");
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/deadlines/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Deadline deleted");
      loadData();
    } catch {
      toast.error("Failed to delete deadline");
    }
  }

  async function parseWhatsApp() {
    if (!waFile && !waText.trim()) {
      toast.error("Upload a WhatsApp .txt export or paste messages first");
      return;
    }
    waAbortRef.current?.abort();
    const ac = new AbortController();
    waAbortRef.current = ac;
    setWaParsing(true);

    const taskId = "whatsapp-extract";
    upsertExternalTask(
      {
        id: taskId,
        feature: "whatsapp_extract",
        title: "WhatsApp Chat Extractor",
        subtitle: `Parsing ${waFile ? waFile.name : "chat text"}...`,
        status: "running",
        actionLabel: "Review Items",
        onOpenResult: () => setWaOpen(true),
      },
      () => ac.abort(),
    );

    try {
      const fd = new FormData();
      if (waFile) fd.append("file", waFile);
      else fd.append("text", waText);

      const res = await fetch("/api/ai/whatsapp", {
        method: "POST",
        body: fd,
        signal: ac.signal,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "WhatsApp parsing failed");

      const dl = (json.deadlines || []).map((d: ExtractedDeadline) => ({
        ...d,
        selected: true,
      }));
      const ev = (json.events || []).map((e: ExtractedEvent) => ({
        ...e,
        selected: true,
      }));
      setWaDeadlines(dl);
      setWaEvents(ev);
      setWaMaterials(json.materials || []);
      upsertExternalTask({
        id: taskId,
        feature: "whatsapp_extract",
        title: "WhatsApp Chat Extractor",
        subtitle: `Found ${dl.length} deadlines, ${ev.length} events`,
        status: "done",
        actionLabel: "Review Items",
        onOpenResult: () => setWaOpen(true),
      });
      toast.success("WhatsApp chat analyzed!");
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        upsertExternalTask({
          id: taskId,
          feature: "whatsapp_extract",
          title: "WhatsApp Chat Extractor",
          subtitle: "Stopped by user",
          status: "stopped",
        });
        toast.info("WhatsApp analysis stopped");
      } else {
        const msg =
          err instanceof Error ? err.message : "Could not parse WhatsApp chat";
        upsertExternalTask({
          id: taskId,
          feature: "whatsapp_extract",
          title: "WhatsApp Chat Extractor",
          subtitle: "Failed",
          status: "error",
          errorText: msg,
        });
        toast.error(msg);
      }
    } finally {
      setWaParsing(false);
    }
  }

  function stopWhatsAppParse() {
    waAbortRef.current?.abort();
  }

  async function importSelectedFromWhatsApp() {
    const selDeadlines = waDeadlines.filter((d) => d.selected);
    const selEvents = waEvents.filter((e) => e.selected);
    if (selDeadlines.length === 0 && selEvents.length === 0) {
      toast.info("Select at least one deadline or event to import");
      return;
    }

    setWaImporting(true);
    try {
      for (const d of selDeadlines) {
        const desc = [
          d.description,
          d.writeupHint ? `Prep hint: ${d.writeupHint}` : null,
        ]
          .filter(Boolean)
          .join("\n");
        await fetch("/api/deadlines", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: d.title,
            description: desc || null,
            deadlineType: d.deadlineType || "ASSIGNMENT",
            dueAt: d.dueAt,
            priority: d.priority || "MEDIUM",
            subjectId: d.subjectId || null,
          }),
        });
      }

      for (const ev of selEvents) {
        await fetch("/api/calendar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: ev.title,
            eventType: ev.eventType || "CUSTOM",
            startAt: ev.startAt,
            endAt: ev.endAt || ev.startAt,
            location: ev.location || null,
            description: ev.description || null,
          }),
        });
      }

      toast.success(
        `Imported ${selDeadlines.length} deadline(s) & ${selEvents.length} calendar event(s)!`,
      );
      setWaOpen(false);
      setWaDeadlines([]);
      setWaEvents([]);
      setWaMaterials([]);
      setWaText("");
      setWaFile(null);
      loadData();
    } catch {
      toast.error("Failed to import some items");
    } finally {
      setWaImporting(false);
    }
  }

  function openSolver(item: DeadlineItem) {
    setHelperTarget(item);
    const savedMode =
      item.aiAnswerMode === "project_report" ||
      item.aiAnswerMode === "viva_prep" ||
      item.aiAnswerMode === "answer"
        ? item.aiAnswerMode
        : item.deadlineType === "PROJECT"
          ? "project_report"
          : "answer";
    setHelperMode(savedMode);
    setSolverQuestions(item.questions || "");
    setSolverFile(null);
    setHelperAnswer(item.aiAnswer || "");
    setHelperThinking("");
    setHelperPromptText("");

    if (item.aiSources) {
      try {
        const parsed = JSON.parse(item.aiSources);
        setHelperSources(parsed.webSources || []);
        setHelperNotes(parsed.openedNotes || []);
      } catch {
        setHelperSources([]);
        setHelperNotes([]);
      }
    } else {
      setHelperSources([]);
      setHelperNotes([]);
    }
  }

  function stopSolver() {
    solverAbortRef.current?.abort();
  }

  async function generateAnswer(modeOverride?: "answer" | "project_report" | "viva_prep") {
    if (!helperTarget) return;
    const targetItem = helperTarget;
    solverAbortRef.current?.abort();
    const ac = new AbortController();
    solverAbortRef.current = ac;

    const mode = modeOverride || helperMode;
    setHelperMode(mode);
    setHelperLoading(true);
    setHelperAnswer("");
    setHelperThinking("");
    setHelperPromptText("");
    setHelperSources([]);
    setHelperNotes([]);

    const taskId = `solver-${targetItem.id}`;
    upsertExternalTask(
      {
        id: taskId,
        feature: `deadline_solver_${mode}`,
        title: "Assignment AI Solver",
        subtitle: `Solving ${targetItem.title}...`,
        status: "running",
        actionLabel: "View Solution",
        onOpenResult: () => {
          setHelperTarget(targetItem);
        },
      },
      () => ac.abort(),
    );

    try {
      const fd = new FormData();
      fd.append("deadlineId", targetItem.id);
      fd.append("mode", mode);
      fd.append("questions", solverQuestions);
      fd.append("useWebSearch", String(useWebSearch));
      fd.append("think", String(helperThink));
      fd.append("stream", "true");
      if (solverFile) fd.append("file", solverFile);

      const res = await fetch("/api/ai/deadline-helper", {
        method: "POST",
        body: fd,
        signal: ac.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "AI solver failed");
      }

      await readSseStream<
        {
          openedNotes?: Array<{ title: string }>;
          webSources?: WebSource[];
          savedQuestions?: string;
          debugMode?: boolean;
          model?: string;
          promptPreview?: string;
        },
        {
          answer: string;
          openedNotes?: Array<{ title: string }>;
          webSources?: WebSource[];
          savedQuestions?: string;
        }
      >(res, {
        onMeta: (meta) => {
          if (meta.webSources) setHelperSources(meta.webSources);
          if (meta.openedNotes) setHelperNotes(meta.openedNotes);
          if (meta.savedQuestions) setSolverQuestions(meta.savedQuestions);
          if (meta.debugMode !== undefined) setHelperDebugMode(meta.debugMode);
          if (meta.model) setHelperModel(meta.model);
          if (meta.promptPreview) setHelperPromptText(meta.promptPreview);
        },
        onThinking: (txt) => {
          setHelperThinking((prev) => prev + txt);
        },
        onToken: (tok) => {
          setHelperAnswer((prev) => prev + tok);
        },
        onDone: (json) => {
          const solvedText = json.answer || "";
          setHelperAnswer(solvedText);
          setHelperSources(json.webSources || []);
          setHelperNotes(json.openedNotes || []);
          if (json.savedQuestions) {
            setSolverQuestions(json.savedQuestions);
          }
          const updatedItem: DeadlineItem = {
            ...targetItem,
            questions: json.savedQuestions || targetItem.questions,
            aiAnswer: solvedText || targetItem.aiAnswer,
            aiAnswerMode: mode,
            aiSources: JSON.stringify({
              openedNotes: json.openedNotes || [],
              webSources: json.webSources || [],
            }),
          };
          setDeadlines((prev) =>
            prev.map((d) => (d.id === targetItem.id ? updatedItem : d)),
          );
          setHelperTarget((prev) =>
            prev && prev.id === targetItem.id ? updatedItem : prev,
          );
          upsertExternalTask({
            id: taskId,
            feature: `deadline_solver_${mode}`,
            title: "Assignment AI Solver",
            subtitle: `Solution ready for ${targetItem.title}`,
            status: "done",
            actionLabel: "View Solution",
            onOpenResult: () => openSolver(updatedItem),
          });
        },
      });
      setSolverFile(null);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        upsertExternalTask({
          id: taskId,
          feature: `deadline_solver_${mode}`,
          title: "Assignment AI Solver",
          subtitle: "Stopped by user",
          status: "stopped",
        });
        toast.info("Generation stopped");
      } else {
        const msg =
          err instanceof Error ? err.message : "Could not solve assignment";
        upsertExternalTask({
          id: taskId,
          feature: `deadline_solver_${mode}`,
          title: "Assignment AI Solver",
          subtitle: "Failed",
          status: "error",
          errorText: msg,
        });
        toast.error(msg);
        setHelperAnswer(`Error: ${msg}`);
      }
    } finally {
      setHelperLoading(false);
    }
  }

  async function copyAnswer() {
    if (!helperAnswer) return;
    await navigator.clipboard.writeText(helperAnswer);
    setCopied(true);
    toast.success("Answer copied!");
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-end justify-between gap-4"
      >
        <div>
          <StudyHeroEmblem icon={Target} eyebrow="Submissions & Exams" accentColor="amber" />
          <h1 className="text-2xl sm:text-3xl font-bold">
            Deadlines & <span className="gradient-text">Assignment Solver</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track exams & assignments, parse WhatsApp exports, and generate
            submission-ready answers grounded in your notes
          </p>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <AiLogsButton />
          <Button variant="outline" onClick={() => setWaOpen(true)}>
            <MessageSquareText className="h-4 w-4 text-emerald-400" />
            WhatsApp Import
          </Button>
          <Button variant="glow" onClick={openNew}>
            <Plus className="h-4 w-4" />
            New Deadline
          </Button>
        </div>
      </motion.div>

      {/* Unified Deadlines Studio Frame (matches /chat box & curve) */}
      <div className="studio-shell">
        {/* Integrated Filter Strip */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-glass-border/60 bg-muted/25 p-3.5 sm:px-5">
          <div className="flex items-center gap-1.5 flex-wrap">
            {[
              { id: "ALL", label: `All (${counts.all})` },
              { id: "PENDING", label: `Pending (${counts.pending})` },
              { id: "IN_PROGRESS", label: `In Progress (${counts.inProgress})` },
              { id: "COMPLETED", label: `Completed (${counts.completed})` },
              { id: "OVERDUE", label: `Overdue (${counts.overdue})` },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setStatusFilter(tab.id)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer",
                  statusFilter === tab.id
                    ? "bg-primary/20 border-primary/50 text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:bg-glass-hover",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-full sm:w-[190px] h-9">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Categories</SelectItem>
              {DEADLINE_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Deadline List Body */}
        <div className="p-4 sm:p-5">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-24 rounded-xl shimmer" />
              ))}
            </div>
          ) : filteredDeadlines.length === 0 ? (
            <div className="py-12 px-6 text-center space-y-3">
              <div className="h-12 w-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center mx-auto">
                <Target className="h-6 w-6 text-amber-400" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-semibold">No deadlines found</h3>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  Use <span className="text-foreground font-medium">WhatsApp Import</span> or{" "}
                  <span className="text-foreground font-medium">New Deadline</span> in the top bar to track upcoming submissions, lab exams, and quizzes.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredDeadlines.map((d) => {
                const isOverdue =
                  d.status !== "COMPLETED" && new Date(d.dueAt) < new Date();
                return (
                  <Card
                    key={d.id}
                    className={cn(
                      "p-4 sm:p-5 transition-all hover:border-primary/35",
                      d.status === "COMPLETED" && "opacity-65",
                    )}
                  >
                    <CardContent className="p-0 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      <div className="flex items-start gap-3.5 min-w-0 flex-1">
                        <button
                          onClick={() => cycleStatus(d)}
                          className="mt-0.5 text-muted-foreground hover:text-primary transition-colors cursor-pointer shrink-0"
                          title="Click to cycle status"
                        >
                          {d.status === "COMPLETED" ? (
                            <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                          ) : d.status === "IN_PROGRESS" ? (
                            <Clock className="h-5 w-5 text-amber-400" />
                          ) : (
                            <Circle className="h-5 w-5" />
                          )}
                        </button>

                        <div className="min-w-0 flex-1 space-y-1.5">
                          <h3
                            className={cn(
                              "font-semibold text-base text-foreground leading-snug",
                              d.status === "COMPLETED" && "line-through",
                            )}
                          >
                            {d.title}
                          </h3>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Badge variant="outline" className="text-[11px]">
                              {DEADLINE_TYPES.find((t) => t.value === d.deadlineType)
                                ?.label || d.deadlineType}
                            </Badge>
                            {d.subject && (
                              <Badge
                                variant="outline"
                                className="text-[11px]"
                                style={{
                                  borderColor: `${d.subject.color}60`,
                                  color: d.subject.color,
                                }}
                              >
                                {d.subject.code || d.subject.name}
                              </Badge>
                            )}
                            {d.questions && (
                              <Badge variant="secondary" className="text-[10px]">
                                Questions Saved
                              </Badge>
                            )}
                            {d.aiAnswer && (
                              <Badge variant="success" className="text-[10px]">
                                Solution Saved
                              </Badge>
                            )}
                          </div>
                          {d.description && (
                            <p className="text-xs text-muted-foreground whitespace-pre-line line-clamp-2">
                              {d.description}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground">
                            Due: {formatDateTime(d.dueAt)}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between lg:justify-end gap-2.5 shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-glass-border/50">
                        <div className="flex items-center gap-2 flex-wrap">
                          {isOverdue && (
                            <Badge variant="destructive" className="gap-1">
                              <AlertTriangle className="h-3 w-3" /> Overdue
                            </Badge>
                          )}
                          <Badge className={getPriorityColor(d.priority)}>
                            {d.priority}
                          </Badge>
                          <span
                            className={cn(
                              "text-xs font-medium min-w-[68px] text-left lg:text-right",
                              d.status === "COMPLETED"
                                ? "text-emerald-400"
                                : getDeadlineColor(d.dueAt),
                            )}
                          >
                            {d.status === "COMPLETED"
                              ? "Done"
                              : formatRelativeTime(d.dueAt)}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs text-accent border-primary/40 hover:bg-primary/15"
                            onClick={() => openSolver(d)}
                          >
                            <Sparkles className="h-3.5 w-3.5 text-primary" /> AI Solve
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => openEdit(d)}
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => handleDelete(d.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Create/Edit Deadline Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit Deadline" : "Add New Deadline"}
            </DialogTitle>
            <DialogDescription>
              Track assignments, lab exams, tests, mid-sems, or group projects.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="dl-title">Title</Label>
              <Input
                id="dl-title"
                placeholder="e.g., C Programming Assignment 2"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select
                  value={deadlineType}
                  onValueChange={(v) =>
                    setDeadlineType(v as DeadlineItem["deadlineType"])
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DEADLINE_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Priority</Label>
                <Select
                  value={priority}
                  onValueChange={(v) =>
                    setPriority(v as DeadlineItem["priority"])
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LOW">Low</SelectItem>
                    <SelectItem value="MEDIUM">Medium</SelectItem>
                    <SelectItem value="HIGH">High</SelectItem>
                    <SelectItem value="URGENT">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dl-date">Due Date</Label>
                <Input
                  id="dl-date"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dl-time">Due Time</Label>
                <Input
                  id="dl-time"
                  type="time"
                  value={dueTime}
                  onChange={(e) => setDueTime(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Subject (Optional)</Label>
                <Select value={subjectId} onValueChange={setSubjectId}>
                  <SelectTrigger>
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">No Subject</SelectItem>
                    {subjects.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.code ? `${s.code} — ${s.name}` : s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={status}
                  onValueChange={(v) => setStatus(v as DeadlineItem["status"])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PENDING">Pending</SelectItem>
                    <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                    <SelectItem value="COMPLETED">Completed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="dl-desc">Notes / Instructions (Optional)</Label>
              <Textarea
                id="dl-desc"
                rows={2}
                placeholder="Submission format, room, or syllabus info..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="dl-questions">
                Assignment Questions / Prompt (Optional — used by AI Solve)
              </Label>
              <Textarea
                id="dl-questions"
                rows={3}
                placeholder="Paste assignment questions here (or upload the question PDF directly inside AI Solve)"
                value={questions}
                onChange={(e) => setQuestions(e.target.value)}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="glow" disabled={submitting}>
                {submitting
                  ? "Saving..."
                  : editing
                    ? "Save Changes"
                    : "Create Deadline"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* WhatsApp Chat Extractor Modal (closing leaves active background task alive) */}
      <Dialog open={waOpen} onOpenChange={setWaOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquareText className="h-5 w-5 text-emerald-400" />
              WhatsApp Group Chat Extractor
            </DialogTitle>
            <DialogDescription>
              Upload your exported WhatsApp <code>.txt</code> chat or paste
              messages to extract assignments, exams, calendar events, and shared
              notes.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-glass-border bg-muted/25 p-3 flex-wrap">
              <div className="flex items-center gap-2.5 min-w-0">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => waFileRef.current?.click()}
                  disabled={waParsing}
                >
                  <Upload className="h-4 w-4" />
                  {waFile ? "Change .txt File" : "Choose WhatsApp .txt Export"}
                </Button>
                {waFile && (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs text-accent max-w-[240px] truncate">
                    <span className="truncate">{waFile.name}</span>
                    <button
                      type="button"
                      onClick={() => setWaFile(null)}
                      className="text-muted-foreground hover:text-foreground cursor-pointer"
                      aria-label="Clear file"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                )}
              </div>
              <input
                ref={waFileRef}
                type="file"
                accept=".txt,text/plain"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0] || null;
                  setWaFile(f);
                }}
              />
              <span className="text-[11px] text-muted-foreground">
                Media & deleted messages auto-filtered
              </span>
            </div>

            {!waFile && (
              <div className="space-y-2">
                <Label>Or paste WhatsApp messages directly</Label>
                <Textarea
                  rows={5}
                  placeholder="Paste exported group chat messages here..."
                  value={waText}
                  onChange={(e) => setWaText(e.target.value)}
                  disabled={waParsing}
                />
              </div>
            )}

            <div className="flex items-center gap-2.5">
              <Button
                type="button"
                variant="glow"
                onClick={parseWhatsApp}
                disabled={waParsing}
              >
                {waParsing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Analyzing Chat (
                    {aiElapsed}s)
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" /> Extract Academic Items
                  </>
                )}
              </Button>
              {waParsing && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={stopWhatsAppParse}
                >
                  <Square className="h-3.5 w-3.5" /> Stop
                </Button>
              )}
            </div>

            {(waDeadlines.length > 0 ||
              waEvents.length > 0 ||
              waMaterials.length > 0) && (
              <div className="space-y-4 pt-4 border-t border-glass-border">
                {waDeadlines.length > 0 && (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-sm font-semibold text-foreground">
                        Deadlines Found ({waDeadlines.filter((d) => d.selected).length}/{waDeadlines.length})
                      </h4>
                      <button
                        type="button"
                        onClick={() => {
                          const allSelected = waDeadlines.every((d) => d.selected);
                          setWaDeadlines((prev) =>
                            prev.map((d) => ({ ...d, selected: !allSelected })),
                          );
                        }}
                        className="text-xs text-primary hover:underline cursor-pointer"
                      >
                        {waDeadlines.every((d) => d.selected)
                          ? "Deselect all"
                          : "Select all"}
                      </button>
                    </div>
                    {waDeadlines.map((d, i) => (
                      <div
                        key={i}
                        className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 rounded-xl border border-glass-border bg-muted/35 p-3.5"
                      >
                        <label className="flex items-start gap-2.5 cursor-pointer flex-1 min-w-0">
                          <input
                            type="checkbox"
                            checked={Boolean(d.selected)}
                            onChange={(e) =>
                              setWaDeadlines((prev) =>
                                prev.map((item, idx) =>
                                  idx === i
                                    ? { ...item, selected: e.target.checked }
                                    : item,
                                ),
                              )
                            }
                            className="mt-1 accent-primary shrink-0"
                          />
                          <div className="text-xs space-y-1 min-w-0">
                            <p className="font-semibold text-sm text-foreground">
                              {d.title}
                            </p>
                            <p className="text-muted-foreground">
                              {d.deadlineType} • Due {formatDateTime(d.dueAt)} •{" "}
                              {d.priority}
                            </p>
                            {d.writeupHint && (
                              <p className="text-accent">
                                What to write: {d.writeupHint}
                              </p>
                            )}
                          </div>
                        </label>
                        {subjects.length > 0 && (
                          <div className="sm:w-44 shrink-0">
                            <Select
                              value={d.subjectId || "NONE"}
                              onValueChange={(v) =>
                                setWaDeadlines((prev) =>
                                  prev.map((item, idx) =>
                                    idx === i
                                      ? { ...item, subjectId: v === "NONE" ? null : v }
                                      : item,
                                  ),
                                )
                              }
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder="Subject" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="NONE">No Subject</SelectItem>
                                {subjects.map((s) => (
                                  <SelectItem key={s.id} value={s.id}>
                                    {s.code || s.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {waEvents.length > 0 && (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                        <CalendarPlus className="h-4 w-4 text-primary" />
                        Calendar Events Found ({waEvents.filter((e) => e.selected).length}/{waEvents.length})
                      </h4>
                      <button
                        type="button"
                        onClick={() => {
                          const allSelected = waEvents.every((e) => e.selected);
                          setWaEvents((prev) =>
                            prev.map((e) => ({ ...e, selected: !allSelected })),
                          );
                        }}
                        className="text-xs text-primary hover:underline cursor-pointer"
                      >
                        {waEvents.every((e) => e.selected)
                          ? "Deselect all"
                          : "Select all"}
                      </button>
                    </div>
                    {waEvents.map((ev, i) => (
                      <label
                        key={i}
                        className="flex items-start gap-2.5 rounded-xl border border-glass-border bg-muted/35 p-3.5 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(ev.selected)}
                          onChange={(e) =>
                            setWaEvents((prev) =>
                              prev.map((item, idx) =>
                                idx === i
                                  ? { ...item, selected: e.target.checked }
                                  : item,
                              ),
                            )
                          }
                          className="mt-1 accent-primary shrink-0"
                        />
                        <div className="text-xs space-y-0.5 min-w-0">
                          <p className="font-semibold text-sm text-foreground">
                            {ev.title}
                          </p>
                          <p className="text-muted-foreground">
                            {ev.eventType} • {formatDateTime(ev.startAt)}
                            {ev.location ? ` @ ${ev.location}` : ""}
                          </p>
                        </div>
                      </label>
                    ))}
                  </div>
                )}

                {waMaterials.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                      <FileText className="h-4 w-4 text-indigo-400" />
                      Mentioned PDFs / Notes ({waMaterials.length})
                    </h4>
                    <div className="space-y-1.5">
                      {waMaterials.map((m, i) => (
                        <div
                          key={i}
                          className="rounded-xl border border-glass-border/60 bg-muted/30 p-3 text-xs"
                        >
                          <span className="font-medium text-foreground">
                            {m.name}
                          </span>
                          {m.subject && (
                            <span className="text-accent"> ({m.subject})</span>
                          )}
                          {m.context && (
                            <p className="text-muted-foreground mt-0.5">
                              {m.context}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <DialogFooter className="pt-2">
                  <Button
                    type="button"
                    variant="glow"
                    onClick={importSelectedFromWhatsApp}
                    disabled={waImporting}
                  >
                    {waImporting
                      ? "Importing..."
                      : "Import Selected Deadlines & Events"}
                  </Button>
                </DialogFooter>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* AI Assignment & Project Answer Solver Modal (closing leaves active solver running in Background AI Dock) */}
      <Dialog
        open={Boolean(helperTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setHelperTarget(null);
          }
        }}
      >
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              AI Assignment & Project Answer Solver
            </DialogTitle>
            <DialogDescription>
              {helperTarget?.title}
              {helperTarget?.subject ? ` • ${helperTarget.subject.name}` : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Mode Selector + AI Toggles */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                {(
                  [
                    { id: "answer", label: "Assignment Answer" },
                    { id: "project_report", label: "Project / Lab Report" },
                    { id: "viva_prep", label: "Exam / Viva Q&A" },
                  ] as const
                ).map((m) => (
                  <Button
                    key={m.id}
                    size="sm"
                    variant={helperMode === m.id ? "default" : "outline"}
                    onClick={() => setHelperMode(m.id)}
                    disabled={helperLoading}
                  >
                    {m.label}
                  </Button>
                ))}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setUseWebSearch(!useWebSearch)}
                  disabled={helperLoading}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-medium border inline-flex items-center gap-1.5 cursor-pointer transition-colors",
                    useWebSearch
                      ? "bg-primary/20 border-primary text-primary"
                      : "border-glass-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Globe className="h-3.5 w-3.5" />
                  Web Search {useWebSearch ? "On" : "Off"}
                </button>
                <button
                  type="button"
                  onClick={() => setHelperThink(!helperThink)}
                  disabled={helperLoading}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-medium border inline-flex items-center gap-1.5 cursor-pointer transition-colors",
                    helperThink
                      ? "bg-primary/20 border-primary text-primary"
                      : "border-glass-border text-muted-foreground hover:text-foreground",
                  )}
                  title="Toggle reasoning before final solution"
                >
                  <Brain className="h-3.5 w-3.5" />
                  Think {helperThink ? "On" : "Off"}
                </button>
              </div>
            </div>

            {/* Prompt / Question Input Card */}
            <div className="space-y-3 rounded-xl border border-glass-border bg-muted/25 p-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <Label className="text-xs font-medium">
                  Assignment Questions / Problem Statement
                </Label>
                <div className="flex items-center gap-2">
                  {solverFile && (
                    <span className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] text-accent max-w-[180px]">
                      <span className="truncate">{solverFile.name}</span>
                      <button
                        type="button"
                        onClick={() => setSolverFile(null)}
                        className="hover:text-foreground cursor-pointer"
                        aria-label="Remove uploaded file"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => assignFileRef.current?.click()}
                    disabled={helperLoading}
                  >
                    <Upload className="h-3.5 w-3.5" />
                    {solverFile ? "Replace Sheet" : "Upload Question Sheet"}
                  </Button>
                  <input
                    ref={assignFileRef}
                    type="file"
                    accept=".pdf,.docx,.pptx,.txt,.md"
                    className="hidden"
                    onChange={(e) =>
                      setSolverFile(e.target.files?.[0] || null)
                    }
                  />
                </div>
              </div>

              <Textarea
                rows={4}
                placeholder="Paste your exact assignment questions, numericals, or group project rubric here..."
                value={solverQuestions}
                onChange={(e) => setSolverQuestions(e.target.value)}
                disabled={helperLoading}
              />

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
                <span className="text-[11px] text-muted-foreground">
                  Grounded in your uploaded subject notes
                  {useWebSearch ? " & verified web search" : ""}.
                </span>
                <div className="flex items-center gap-2 justify-end">
                  {helperLoading && (
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={stopSolver}
                    >
                      <Square className="h-3.5 w-3.5" /> Stop
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="glow"
                    onClick={() => generateAnswer()}
                    disabled={helperLoading}
                  >
                    {helperLoading ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Generating ({aiElapsed}s)
                      </>
                    ) : helperAnswer ? (
                      <>
                        <Sparkles className="h-3.5 w-3.5" /> Regenerate Solution
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-3.5 w-3.5" /> Generate Detailed
                        Solution
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>

            {(helperLoading || helperAnswer) && (
              <div className="rounded-xl border border-glass-border bg-muted/35 p-4 sm:p-5 space-y-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-accent">
                    Generated Solution
                  </span>
                  {helperAnswer && !helperLoading && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={copyAnswer}
                    >
                      {copied ? (
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      {copied ? "Copied" : "Copy Markdown"}
                    </Button>
                  )}
                </div>

                <AiDebugPanel
                  active={helperDebugMode}
                  loading={helperLoading && !helperAnswer}
                  elapsedSeconds={aiElapsed}
                  thinkingText={helperThinking}
                  promptText={helperPromptText}
                  model={helperModel}
                />

                {helperLoading && !helperAnswer ? (
                  <div className="flex flex-col items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    <span>
                      Searching notes{useWebSearch ? " & web" : ""} and writing
                      full detailed answer... ({aiElapsed}s)
                    </span>
                    <span className="text-xs opacity-70">
                      Streaming tokens live as soon as the model starts
                    </span>
                  </div>
                ) : (
                  <div className="max-h-[400px] overflow-y-auto pr-1">
                    <MarkdownRenderer content={helperAnswer} />
                  </div>
                )}

                {(helperNotes.length > 0 || helperSources.length > 0) &&
                  !helperLoading && (
                    <div className="pt-3 border-t border-glass-border/50 flex flex-wrap gap-1.5">
                      {helperNotes.map((n, i) => (
                        <Badge key={i} variant="outline" className="text-[10px]">
                          Note: {n.title}
                        </Badge>
                      ))}
                      {helperSources.map((s, i) => (
                        <a
                          key={i}
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-md border border-glass-border px-2 py-0.5 text-[10px] text-accent hover:border-primary"
                        >
                          <Globe className="h-2.5 w-2.5" />
                          {s.title.slice(0, 42)}
                        </a>
                      ))}
                    </div>
                  )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
