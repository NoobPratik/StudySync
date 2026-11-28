"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Target,
  Clock,
  Calendar as CalendarIcon,
  FileText,
  Plus,
  ArrowRight,
  CheckCircle2,
  Circle,
  Sparkles,
  Flame,
  CalendarClock,
  Download,
  ArrowUp,
  ArrowDown,
  GripVertical,
  Loader2,
  SlidersHorizontal,
  Bot,
  Zap,
  BookOpen,
  Layers,
  LayoutDashboard,
  MapPin,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AiLogsButton } from "@/components/ui/ai-logs-dialog";
import { useBackgroundAi } from "@/components/background-extraction-provider";
import {
  cn,
  formatDate,
  formatDateTime,
  formatFileSize,
  formatRelativeTime,
  getDeadlineColor,
  getPriorityColor,
} from "@/lib/utils";
import { useSession } from "@/lib/auth-client";
import { getBrowserTimeZone } from "@/lib/timezone";
import { StudyHeroEmblem } from "@/components/ui/study-emblem";

type LayoutMode = "BENTO_360" | "EXAM_SPRINT" | "DEEP_STUDY" | "DAILY_AGENDA";

interface DashboardData {
  stats: {
    pendingDeadlines: number;
    todayEventsCount: number;
    todayFocusMinutes: number;
    todaySessionsCount: number;
    notesCount: number;
    subjectsCount: number;
    totalTopics: number;
    completedTopics: number;
    remainingTopics: number;
    overallProgress: number;
    daysLeft: number | null;
    topicsPerDay: number | null;
  };
  upcomingDeadlines: Array<{
    id: string;
    title: string;
    deadlineType: string;
    dueAt: string;
    priority: string;
    status: string;
    subject: { id: string; name: string; code: string | null; color: string } | null;
  }>;
  todayEvents: Array<{
    id: string;
    occurrenceId?: string;
    title: string;
    eventType: string;
    startAt: string;
    endAt: string;
    allDay: boolean;
    location: string | null;
    color: string | null;
  }>;
  upcomingEvents: Array<{
    id: string;
    occurrenceId?: string;
    title: string;
    eventType: string;
    startAt: string;
    endAt: string;
    allDay: boolean;
    location: string | null;
    color: string | null;
  }>;
  subjectProgress: Array<{
    id: string;
    name: string;
    code: string | null;
    color: string;
    totalTopics: number;
    completedTopics: number;
    percentage: number;
  }>;
  recentNotes: Array<{
    id: string;
    title: string;
    fileName: string;
    fileSize: number;
    uploadedAt: string;
    subject: { id: string; name: string; code: string | null; color: string } | null;
  }>;
  nextStudyTarget?: {
    subjectId: string;
    subjectName: string;
    subjectColor: string;
    moduleId: string;
    moduleName: string;
    topicId: string;
    topicName: string;
  } | null;
  profile: {
    program: string | null;
    branch: string | null;
    semester: string | null;
    semesterEndDate: string | null;
  } | null;
  cardOrder?: string[];
  aiBriefing?: {
    layoutMode?: LayoutMode;
    headline?: string;
    summary: string;
    reason?: string;
    focusTip?: string;
    primaryAction?: { label: string; href: string };
    updatedAt: string;
  } | null;
}

const DEFAULT_ORDER = ["deadlines", "schedule", "pacing", "subjects", "notes"];

const LAYOUT_PRESETS: Array<{
  id: LayoutMode;
  label: string;
  icon: typeof LayoutDashboard;
  desc: string;
}> = [
  {
    id: "BENTO_360",
    label: "Bento 360°",
    icon: LayoutDashboard,
    desc: "Balanced academic cockpit",
  },
  {
    id: "EXAM_SPRINT",
    label: "Exam Sprint",
    icon: Zap,
    desc: "Deadlines & practice front-and-center",
  },
  {
    id: "DEEP_STUDY",
    label: "Deep Study",
    icon: BookOpen,
    desc: "Next syllabus topic & mastery rings",
  },
  {
    id: "DAILY_AGENDA",
    label: "Day Agenda",
    icon: CalendarClock,
    desc: "Chronological classes & pacing",
  },
];

function RadialProgress({
  value,
  size = 86,
  strokeWidth = 7,
  color = "#7C3AED",
  label,
}: {
  value: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div
      className="relative inline-flex items-center justify-center shrink-0"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(124, 58, 237, 0.14)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-sm font-bold text-foreground leading-none">
          {clamped}%
        </span>
        {label && (
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground mt-0.5">
            {label}
          </span>
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const { startAiTask } = useBackgroundAi();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [cardOrder, setCardOrder] = useState<string[]>(DEFAULT_ORDER);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("BENTO_360");
  const [aiBriefing, setAiBriefing] = useState<DashboardData["aiBriefing"]>(null);
  const [customizeMode, setCustomizeMode] = useState(false);
  const [prioritizing, setPrioritizing] = useState(false);

  const applyDashboardJson = useCallback((json: DashboardData) => {
    setData(json);
    if (json.cardOrder) setCardOrder(json.cardOrder);
    setAiBriefing(json.aiBriefing || null);
    if (json.aiBriefing?.layoutMode) {
      setLayoutMode(json.aiBriefing.layoutMode);
    }
  }, []);

  const loadDashboard = useCallback(async () => {
    try {
      const tz = encodeURIComponent(getBrowserTimeZone());
      const res = await fetch(`/api/dashboard?tz=${tz}`);
      if (!res.ok) throw new Error("Failed to load dashboard");
      const json: DashboardData = await res.json();
      applyDashboardJson(json);
    } catch {
      toast.error("Could not load dashboard data");
    } finally {
      setLoading(false);
    }
  }, [applyDashboardJson]);

  useEffect(() => {
    let active = true;
    const tz = encodeURIComponent(getBrowserTimeZone());
    fetch(`/api/dashboard?tz=${tz}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load dashboard");
        return res.json();
      })
      .then((json: DashboardData) => {
        if (active) applyDashboardJson(json);
      })
      .catch(() => {
        if (active) toast.error("Could not load dashboard data");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [applyDashboardJson]);

  async function toggleDeadlineDone(id: string, currentStatus: string) {
    const nextStatus = currentStatus === "COMPLETED" ? "PENDING" : "COMPLETED";
    try {
      const res = await fetch(`/api/deadlines/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) throw new Error();
      toast.success(
        nextStatus === "COMPLETED" ? "Deadline completed!" : "Reopened deadline",
      );
      loadDashboard();
    } catch {
      toast.error("Failed to update deadline");
    }
  }

  async function saveLayoutPreset(nextMode: LayoutMode) {
    setLayoutMode(nextMode);
    try {
      await fetch("/api/dashboard", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layoutMode: nextMode }),
      });
    } catch {
      toast.error("Could not save layout preset");
    }
  }

  async function saveCardOrder(nextOrder: string[]) {
    setCardOrder(nextOrder);
    try {
      await fetch("/api/dashboard", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardOrder: nextOrder }),
      });
    } catch {
      toast.error("Could not save card order");
    }
  }

  function moveCard(cardId: string, dir: -1 | 1) {
    const idx = cardOrder.indexOf(cardId);
    const target = idx + dir;
    if (idx === -1 || target < 0 || target >= cardOrder.length) return;
    const copy = [...cardOrder];
    const [removed] = copy.splice(idx, 1);
    copy.splice(target, 0, removed);
    saveCardOrder(copy);
  }

  async function runAiPrioritize() {
    setPrioritizing(true);
    try {
      await startAiTask({
        id: "dashboard-adapt",
        feature: "dashboard_prioritize",
        title: "Adaptive Dashboard Architect",
        subtitle: "Analyzing deadlines, timetable & syllabus progress...",
        actionLabel: "View Dashboard",
        actionHref: "/dashboard",
        run: async (signal) => {
          const res = await fetch("/api/ai/dashboard", {
            method: "POST",
            signal,
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || "AI adaptation failed");
          return json as {
            cardOrder?: string[];
            aiBriefing?: DashboardData["aiBriefing"];
          };
        },
        onComplete: (json) => {
          if (json.cardOrder) setCardOrder(json.cardOrder);
          if (json.aiBriefing) {
            setAiBriefing(json.aiBriefing);
            if (json.aiBriefing.layoutMode) {
              setLayoutMode(json.aiBriefing.layoutMode);
            }
          }
          toast.success(
            `Dashboard adapted to ${json.aiBriefing?.layoutMode?.replace("_", " ") || "priority"} mode!`,
          );
        },
      });
    } finally {
      setPrioritizing(false);
    }
  }

  const firstName = session?.user?.name?.split(" ")[0] || "Student";
  const stats = data?.stats;
  const nextTopic = data?.nextStudyTarget;

  const scheduleEvents = useMemo(
    () =>
      data?.todayEvents.length
        ? data.todayEvents
        : data?.upcomingEvents || [],
    [data],
  );

  // Dynamic primary spotlight if user hasn't run AI yet
  const heroHeadline = useMemo(() => {
    if (aiBriefing?.headline) return aiBriefing.headline;
    if (layoutMode === "EXAM_SPRINT" && (stats?.pendingDeadlines ?? 0) > 0) {
      return `${stats?.pendingDeadlines} Active Submission${stats?.pendingDeadlines === 1 ? "" : "s"} Ahead`;
    }
    if (layoutMode === "DEEP_STUDY" && nextTopic) {
      return `Up Next: ${nextTopic.topicName}`;
    }
    if (layoutMode === "DAILY_AGENDA" && (stats?.todayEventsCount ?? 0) > 0) {
      return `${stats?.todayEventsCount} Class${stats?.todayEventsCount === 1 ? "" : "es"} Scheduled Today`;
    }
    return `Your Academic Command Studio`;
  }, [aiBriefing, layoutMode, stats, nextTopic]);

  const heroPrimaryCta = useMemo(() => {
    if (aiBriefing?.primaryAction) return aiBriefing.primaryAction;
    if (nextTopic) {
      return {
        label: `Study: ${nextTopic.topicName.slice(0, 26)}${nextTopic.topicName.length > 26 ? "…" : ""}`,
        href: `/chat?study=1&subjectId=${encodeURIComponent(nextTopic.subjectId)}&moduleId=${encodeURIComponent(nextTopic.moduleId)}&topicId=${encodeURIComponent(nextTopic.topicId)}`,
      };
    }
    if ((stats?.pendingDeadlines ?? 0) > 0) {
      return { label: "Open Assignment Solver", href: "/deadlines" };
    }
    return { label: "Launch AI Tutor", href: "/chat" };
  }, [aiBriefing, nextTopic, stats]);

  const displayedCards = useMemo(() => {
    if (customizeMode) return cardOrder;
    if (layoutMode === "EXAM_SPRINT") {
      return ["deadlines", "subjects", "pacing", "schedule", "notes"];
    }
    if (layoutMode === "DEEP_STUDY") {
      return ["subjects", "pacing", "schedule", "deadlines", "notes"];
    }
    if (layoutMode === "DAILY_AGENDA") {
      return ["schedule", "deadlines", "pacing", "notes", "subjects"];
    }
    return cardOrder;
  }, [customizeMode, layoutMode, cardOrder]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-12 w-72 rounded-xl shimmer" />
        <div className="h-52 rounded-2xl shimmer" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-80 rounded-2xl shimmer" />
          <div className="h-80 rounded-2xl shimmer" />
        </div>
      </div>
    );
  }

  const renderSectionCard = (key: string, idx: number, fullSpan = false) => {
    const reorderControls = customizeMode ? (
      <div className="flex items-center gap-1 ml-1.5">
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={idx === 0}
          onClick={() => moveCard(key, -1)}
          title="Move up"
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={idx === cardOrder.length - 1}
          onClick={() => moveCard(key, 1)}
          title="Move down"
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </Button>
      </div>
    ) : null;

    switch (key) {
      case "pacing":
        return (
          <div
            key="pacing"
            className={cn(
              "studio-shell p-5 sm:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4",
              (fullSpan || layoutMode === "BENTO_360") && "lg:col-span-2",
            )}
          >
            <div className="flex items-start gap-4">
              <div className="h-12 w-12 rounded-2xl bg-primary/20 border border-primary/35 flex items-center justify-center shrink-0 glow-purple">
                <Sparkles className="h-6 w-6 text-primary" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-base font-semibold text-foreground">
                    Semester Pacing Balance
                  </h3>
                  {stats?.daysLeft !== null && stats?.daysLeft !== undefined && (
                    <Badge variant="outline" className="text-[10px]">
                      {stats.daysLeft}d left
                    </Badge>
                  )}
                </div>
                {stats && stats.totalTopics === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Extract topics from your PDFs in{" "}
                    <Link
                      href="/notes"
                      className="text-accent underline underline-offset-4"
                    >
                      Notes
                    </Link>{" "}
                    or{" "}
                    <Link
                      href="/progress"
                      className="text-accent underline underline-offset-4"
                    >
                      Progress
                    </Link>{" "}
                    to track daily study pacing.
                  </p>
                ) : stats?.daysLeft !== null && stats?.daysLeft !== undefined ? (
                  <p className="text-sm text-muted-foreground">
                    <span className="text-foreground font-semibold">
                      {stats.remainingTopics} topics remaining
                    </span>{" "}
                    — cover{" "}
                    <span className="text-accent font-semibold">
                      {stats.topicsPerDay} topics/day
                    </span>{" "}
                    to hit 100% syllabus coverage before finals.
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {stats?.remainingTopics ?? 0} topics remaining. Set your exam
                    date in{" "}
                    <Link
                      href="/profile"
                      className="text-accent underline underline-offset-4"
                    >
                      Profile
                    </Link>{" "}
                    to calculate your daily target.
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="w-36 hidden sm:block space-y-1">
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>Syllabus</span>
                  <span>{stats?.overallProgress ?? 0}%</span>
                </div>
                <Progress value={stats?.overallProgress ?? 0} />
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link href="/progress">Open Roadmap</Link>
              </Button>
              {reorderControls}
            </div>
          </div>
        );

      case "deadlines":
        return (
          <div key="deadlines" className="studio-shell flex flex-col h-full">
            <div className="px-5 py-3.5 border-b border-glass-border/60 bg-muted/20 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Target className="h-4 w-4 text-fuchsia-400 shrink-0" />
                <h3 className="font-semibold text-sm truncate">
                  Upcoming Deadlines
                </h3>
                <Badge variant="outline" className="text-[10px]">
                  {stats?.pendingDeadlines ?? 0}
                </Badge>
              </div>
              <div className="flex items-center">
                <Button variant="ghost" size="sm" className="h-7 text-xs" asChild>
                  <Link href="/deadlines">
                    Manage <ArrowRight className="h-3 w-3" />
                  </Link>
                </Button>
                {reorderControls}
              </div>
            </div>

            <div className="p-4 sm:p-5 flex-1">
              {data?.upcomingDeadlines.length === 0 ? (
                <div className="h-full min-h-[190px] rounded-xl border border-dashed border-glass-border/70 p-6 flex flex-col items-center justify-center text-center space-y-2.5">
                  <Target className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    All caught up — no pending deadlines.
                  </p>
                  <Button size="sm" variant="outline" asChild>
                    <Link href="/deadlines">
                      <Plus className="h-3.5 w-3.5" /> Add or Import WhatsApp
                    </Link>
                  </Button>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {data?.upcomingDeadlines.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-glass-border/70 bg-muted/35 p-3 hover:border-primary/40 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <button
                          onClick={() => toggleDeadlineDone(d.id, d.status)}
                          className="text-muted-foreground hover:text-primary transition-colors cursor-pointer shrink-0"
                          title="Mark as completed"
                        >
                          {d.status === "COMPLETED" ? (
                            <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                          ) : (
                            <Circle className="h-5 w-5" />
                          )}
                        </button>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">
                            {d.title}
                          </p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5 flex-wrap">
                            <span>{d.deadlineType.replace("_", " ")}</span>
                            {d.subject && (
                              <>
                                <span>•</span>
                                <span className="inline-flex items-center gap-1">
                                  <span
                                    className="h-2 w-2 rounded-full"
                                    style={{ backgroundColor: d.subject.color }}
                                  />
                                  {d.subject.code || d.subject.name}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge className={getPriorityColor(d.priority)}>
                          {d.priority}
                        </Badge>
                        <span
                          className={`text-xs font-medium ${getDeadlineColor(d.dueAt)}`}
                        >
                          {formatRelativeTime(d.dueAt)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );

      case "schedule":
        return (
          <div key="schedule" className="studio-shell flex flex-col h-full">
            <div className="px-5 py-3.5 border-b border-glass-border/60 bg-muted/20 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <CalendarIcon className="h-4 w-4 text-indigo-400 shrink-0" />
                <h3 className="font-semibold text-sm truncate">
                  {data?.todayEvents.length
                    ? "Today's Lectures & Events"
                    : "Upcoming Schedule"}
                </h3>
              </div>
              <div className="flex items-center">
                <Button variant="ghost" size="sm" className="h-7 text-xs" asChild>
                  <Link href="/calendar">
                    Timetable <ArrowRight className="h-3 w-3" />
                  </Link>
                </Button>
                {reorderControls}
              </div>
            </div>

            <div className="p-4 sm:p-5 flex-1">
              {scheduleEvents.length === 0 ? (
                <div className="h-full min-h-[190px] rounded-xl border border-dashed border-glass-border/70 p-6 flex flex-col items-center justify-center text-center space-y-2.5">
                  <CalendarClock className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    No upcoming lectures or exams.
                  </p>
                  <Button size="sm" variant="outline" asChild>
                    <Link href="/calendar">Import Timetable</Link>
                  </Button>
                </div>
              ) : (
                <div className="relative pl-4 space-y-2.5 before:content-[''] before:absolute before:left-[5px] before:top-2 before:bottom-2 before:w-px before:bg-gradient-to-b before:from-primary/60 before:via-glass-border before:to-transparent max-h-[340px] overflow-y-auto pr-1">
                  {scheduleEvents.map((ev) => (
                    <div
                      key={ev.occurrenceId || ev.id}
                      className="relative flex items-start justify-between gap-3 rounded-xl border border-glass-border/70 bg-muted/35 p-3"
                    >
                      <span
                        className="absolute -left-[15px] top-4 h-2.5 w-2.5 rounded-full ring-4 ring-background"
                        style={{ backgroundColor: ev.color || "#7C3AED" }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">
                          {ev.title}
                        </p>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5 flex-wrap">
                          <span>
                            {ev.allDay
                              ? `${formatDate(ev.startAt)} • All day`
                              : formatDateTime(ev.startAt)}
                          </span>
                          {ev.location && (
                            <span className="inline-flex items-center gap-1 text-accent">
                              <MapPin className="h-3 w-3" />
                              {ev.location}
                            </span>
                          )}
                        </div>
                      </div>
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        {ev.eventType}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );

      case "subjects":
        return (
          <div key="subjects" className="studio-shell flex flex-col h-full">
            <div className="px-5 py-3.5 border-b border-glass-border/60 bg-muted/20 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Layers className="h-4 w-4 text-emerald-400 shrink-0" />
                <h3 className="font-semibold text-sm truncate">
                  Subject Mastery
                </h3>
              </div>
              <div className="flex items-center">
                <Button variant="ghost" size="sm" className="h-7 text-xs" asChild>
                  <Link href="/progress">
                    Syllabus <ArrowRight className="h-3 w-3" />
                  </Link>
                </Button>
                {reorderControls}
              </div>
            </div>

            <div className="p-4 sm:p-5 flex-1">
              {data?.subjectProgress.length === 0 ? (
                <div className="h-full min-h-[190px] rounded-xl border border-dashed border-glass-border/70 p-6 flex flex-col items-center justify-center text-center space-y-2.5">
                  <p className="text-sm text-muted-foreground">
                    No subjects tracked yet.
                  </p>
                  <Button size="sm" variant="outline" asChild>
                    <Link href="/progress">Add Subjects</Link>
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {data?.subjectProgress.map((sub) => (
                    <Link
                      key={sub.id}
                      href="/progress"
                      className="rounded-xl border border-glass-border/70 bg-muted/30 p-3 flex items-center gap-3 hover:border-primary/40 transition-colors"
                    >
                      <RadialProgress
                        value={sub.percentage}
                        size={52}
                        strokeWidth={5}
                        color={sub.color}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-foreground truncate">
                          {sub.name}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {sub.completedTopics}/{sub.totalTopics} topics
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        );

      case "notes":
        return (
          <div key="notes" className="studio-shell flex flex-col h-full">
            <div className="px-5 py-3.5 border-b border-glass-border/60 bg-muted/20 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="h-4 w-4 text-violet-400 shrink-0" />
                <h3 className="font-semibold text-sm truncate">
                  Recent Course Files
                </h3>
              </div>
              <div className="flex items-center">
                <Button variant="ghost" size="sm" className="h-7 text-xs" asChild>
                  <Link href="/notes">
                    Vault <ArrowRight className="h-3 w-3" />
                  </Link>
                </Button>
                {reorderControls}
              </div>
            </div>

            <div className="p-4 sm:p-5 flex-1">
              {data?.recentNotes.length === 0 ? (
                <div className="h-full min-h-[190px] rounded-xl border border-dashed border-glass-border/70 p-6 flex flex-col items-center justify-center text-center space-y-2.5">
                  <p className="text-sm text-muted-foreground">
                    No lecture PDFs uploaded yet.
                  </p>
                  <Button size="sm" variant="outline" asChild>
                    <Link href="/notes">Upload Notes</Link>
                  </Button>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {data?.recentNotes.map((note) => (
                    <div
                      key={note.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-glass-border/70 bg-muted/35 p-3 hover:border-primary/35 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0 border border-glass-border/60"
                          style={{
                            backgroundColor: note.subject?.color
                              ? `${note.subject.color}20`
                              : "rgba(124, 58, 237, 0.15)",
                          }}
                        >
                          <FileText
                            className="h-4 w-4"
                            style={{ color: note.subject?.color || "#A78BFA" }}
                          />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">
                            {note.title}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {formatFileSize(note.fileSize)} •{" "}
                            {note.subject?.name || "Uncategorized"}
                          </p>
                        </div>
                      </div>
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" asChild>
                        <a
                          href={`/api/notes/${note.id}/download`}
                          title="Download"
                        >
                          <Download className="h-4 w-4" />
                        </a>
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header + Mode Switcher */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col xl:flex-row xl:items-end justify-between gap-4"
      >
        <div>
          <StudyHeroEmblem icon={Flame} eyebrow="Adaptive Command Center" accentColor="violet" />
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
              Welcome back, <span className="gradient-text">{firstName}</span>
            </h1>
            {data?.profile?.program && (
              <Badge variant="default" className="text-xs">
                {[
                  data.profile.program,
                  data.profile.branch,
                  data.profile.semester ? `Sem ${data.profile.semester}` : null,
                ]
                  .filter(Boolean)
                  .join(" • ")}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {new Intl.DateTimeFormat("en-IN", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            }).format(new Date())}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <AiLogsButton size="sm" variant="outline" className="h-9" />
          <div className="inline-flex rounded-xl border border-glass-border bg-muted/40 p-1 gap-1 flex-wrap">
            {LAYOUT_PRESETS.map((preset) => {
              const Icon = preset.icon;
              const active = layoutMode === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => saveLayoutPreset(preset.id)}
                  title={preset.desc}
                  className={cn(
                    "px-2.5 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-all cursor-pointer",
                    active
                      ? "bg-primary text-white shadow"
                      : "text-muted-foreground hover:text-foreground hover:bg-glass-hover",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{preset.label}</span>
                </button>
              );
            })}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-9"
            onClick={() => setCustomizeMode(!customizeMode)}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            {customizeMode ? "Done" : "Reorder"}
          </Button>
          <Button
            variant="glow"
            size="sm"
            className="h-9"
            onClick={runAiPrioritize}
            disabled={prioritizing}
          >
            {prioritizing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            AI Adapt
          </Button>
        </div>
      </motion.div>

      {/* Dynamic Hero Studio Shell (matches /chat box & curve) */}
      <div className="studio-shell gradient-border">
        <div className="p-5 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          {/* Left: Dynamic Briefing + Next Action Spotlight */}
          <div className="lg:col-span-7 space-y-3.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/15 px-2.5 py-1 text-[11px] font-semibold text-accent">
                <Bot className="h-3.5 w-3.5 text-primary" />
                {LAYOUT_PRESETS.find((p) => p.id === layoutMode)?.label || "Bento 360°"}
              </span>
              {aiBriefing?.reason && (
                <Badge variant="outline" className="text-[11px]">
                  {aiBriefing.reason}
                </Badge>
              )}
            </div>

            <div className="space-y-1.5">
              <h2 className="text-xl sm:text-2xl font-bold text-foreground leading-snug">
                {heroHeadline}
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {aiBriefing?.summary ||
                  (nextTopic
                    ? `Recommended next milestone: ${nextTopic.subjectName} — ${nextTopic.moduleName} → "${nextTopic.topicName}".`
                    : "Track deadlines, syllabus topics, and weekly lectures from your adaptive academic cockpit.")}
              </p>
              {aiBriefing?.focusTip && (
                <p className="text-xs text-accent/90 bg-primary/10 border border-primary/25 rounded-lg px-3 py-1.5 inline-block">
                  Tip: {aiBriefing.focusTip}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2.5 flex-wrap pt-1">
              <Button variant="glow" size="sm" asChild>
                <Link href={heroPrimaryCta.href}>
                  <Sparkles className="h-3.5 w-3.5" />
                  {heroPrimaryCta.label}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href="/pomodoro">
                  <Clock className="h-3.5 w-3.5 text-primary" /> Start Focus Timer
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href="/practice">
                  <Layers className="h-3.5 w-3.5 text-emerald-400" /> Practice Studio
                </Link>
              </Button>
            </div>
          </div>

          {/* Right: Circular Syllabus Gauge + Compact Metric Tiles */}
          <div className="lg:col-span-5 flex flex-col sm:flex-row lg:flex-col xl:flex-row items-center gap-4 rounded-2xl border border-glass-border/70 bg-muted/25 p-4">
            <RadialProgress
              value={stats?.overallProgress ?? 0}
              size={96}
              strokeWidth={8}
              color="#8B5CF6"
              label="Syllabus"
            />
            <div className="grid grid-cols-2 gap-2.5 flex-1 w-full">
              <Link
                href="/deadlines"
                className="rounded-xl border border-glass-border/60 bg-background/40 p-2.5 hover:border-primary/40 transition-colors"
              >
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Deadlines
                </p>
                <p className="text-lg font-bold text-foreground mt-0.5">
                  {stats?.pendingDeadlines ?? 0}
                </p>
              </Link>
              <Link
                href="/calendar"
                className="rounded-xl border border-glass-border/60 bg-background/40 p-2.5 hover:border-primary/40 transition-colors"
              >
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Classes Today
                </p>
                <p className="text-lg font-bold text-foreground mt-0.5">
                  {stats?.todayEventsCount ?? 0}
                </p>
              </Link>
              <Link
                href="/pomodoro"
                className="rounded-xl border border-glass-border/60 bg-background/40 p-2.5 hover:border-primary/40 transition-colors"
              >
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Focus Today
                </p>
                <p className="text-lg font-bold text-foreground mt-0.5">
                  {stats?.todayFocusMinutes ?? 0}m
                </p>
              </Link>
              <Link
                href="/notes"
                className="rounded-xl border border-glass-border/60 bg-background/40 p-2.5 hover:border-primary/40 transition-colors"
              >
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Notes Vault
                </p>
                <p className="text-lg font-bold text-foreground mt-0.5">
                  {stats?.notesCount ?? 0}
                </p>
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Dynamic Layout Bento Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
        {displayedCards.map((key, idx) => renderSectionCard(key, idx))}
      </div>
    </div>
  );
}
