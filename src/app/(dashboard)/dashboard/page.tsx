"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Target,
  Clock,
  Calendar as CalendarIcon,
  FileText,
  BarChart3,
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
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  formatDate,
  formatDateTime,
  formatRelativeTime,
  formatFileSize,
  getDeadlineColor,
  getPriorityColor,
} from "@/lib/utils";
import { useSession } from "@/lib/auth-client";
import { getBrowserTimeZone } from "@/lib/timezone";
import { StudyHeroEmblem } from "@/components/ui/study-emblem";

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
  profile: {
    program: string | null;
    branch: string | null;
    semester: string | null;
    semesterEndDate: string | null;
  } | null;
  cardOrder?: string[];
  aiBriefing?: {
    summary: string;
    reason?: string;
    updatedAt: string;
  } | null;
}

const DEFAULT_ORDER = ["deadlines", "schedule", "pacing", "subjects", "notes"];

export default function DashboardPage() {
  const { data: session } = useSession();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [cardOrder, setCardOrder] = useState<string[]>(DEFAULT_ORDER);
  const [aiBriefing, setAiBriefing] = useState<DashboardData["aiBriefing"]>(null);
  const [customizeMode, setCustomizeMode] = useState(false);
  const [prioritizing, setPrioritizing] = useState(false);

  const loadDashboard = useCallback(async () => {
    try {
      const tz = encodeURIComponent(getBrowserTimeZone());
      const res = await fetch(`/api/dashboard?tz=${tz}`);
      if (!res.ok) throw new Error("Failed to load dashboard");
      const json: DashboardData = await res.json();
      setData(json);
      if (json.cardOrder) setCardOrder(json.cardOrder);
      setAiBriefing(json.aiBriefing || null);
    } catch {
      toast.error("Could not load dashboard data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const tz = encodeURIComponent(getBrowserTimeZone());
    fetch(`/api/dashboard?tz=${tz}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load dashboard");
        return res.json();
      })
      .then((json: DashboardData) => {
        if (!active) return;
        setData(json);
        if (json.cardOrder) setCardOrder(json.cardOrder);
        setAiBriefing(json.aiBriefing || null);
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
  }, []);

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
      const res = await fetch("/api/ai/dashboard", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "AI prioritization failed");
      if (json.cardOrder) setCardOrder(json.cardOrder);
      if (json.aiBriefing) setAiBriefing(json.aiBriefing);
      toast.success("Dashboard prioritized by AI!");
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Configure your AI provider in Settings first",
      );
    } finally {
      setPrioritizing(false);
    }
  }

  const firstName = session?.user?.name?.split(" ")[0] || "Student";

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-12 w-72 rounded-lg shimmer" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-36 rounded-xl shimmer" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-80 rounded-xl shimmer" />
          <div className="h-80 rounded-xl shimmer" />
        </div>
      </div>
    );
  }

  const stats = data?.stats;

  const renderSectionCard = (key: string, idx: number) => {
    const reorderControls = customizeMode ? (
      <div className="flex items-center gap-1 ml-2">
        <GripVertical className="h-4 w-4 text-muted-foreground" />
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
          <Card key="pacing" className="gradient-border lg:col-span-2">
            <CardContent className="pt-0 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="h-12 w-12 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center shrink-0 glow-purple">
                  <Sparkles className="h-6 w-6 text-primary" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-base font-semibold text-foreground">
                    Semester Pacing Balance
                  </h3>
                  {stats && stats.totalTopics === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Add subjects & topics in{" "}
                      <Link
                        href="/progress"
                        className="text-accent underline underline-offset-4"
                      >
                        Progress
                      </Link>{" "}
                      (or extract them from notes!) to calculate daily pacing.
                    </p>
                  ) : stats?.daysLeft !== null && stats?.daysLeft !== undefined ? (
                    <p className="text-sm text-muted-foreground">
                      <span className="text-foreground font-semibold">
                        {stats.remainingTopics} topics left
                      </span>{" "}
                      across{" "}
                      <span className="text-foreground font-semibold">
                        {stats.daysLeft} days left
                      </span>{" "}
                      — cover{" "}
                      <span className="text-accent font-semibold">
                        {stats.topicsPerDay} topics/day
                      </span>{" "}
                      to stay 100% ready.
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {stats?.remainingTopics ?? 0} topics remaining. Set your
                      target exam date in{" "}
                      <Link
                        href="/profile"
                        className="text-accent underline underline-offset-4"
                      >
                        Profile
                      </Link>{" "}
                      to compute your daily pace.
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="w-36 hidden sm:block">
                  <Progress value={stats?.overallProgress ?? 0} />
                </div>
                <Button variant="outline" size="sm" asChild>
                  <Link href="/progress">Open Progress</Link>
                </Button>
                {reorderControls}
              </div>
            </CardContent>
          </Card>
        );

      case "deadlines":
        return (
          <Card key="deadlines" className="h-full flex flex-col">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Upcoming Deadlines</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Assignments, lab exams, tests & semester exams
                </p>
              </div>
              <div className="flex items-center">
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/deadlines">
                    View all <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
                {reorderControls}
              </div>
            </CardHeader>
            <CardContent className="flex-1">
              {data?.upcomingDeadlines.length === 0 ? (
                <div className="rounded-xl border border-dashed border-glass-border p-8 text-center space-y-3">
                  <Target className="h-8 w-8 text-muted-foreground mx-auto" />
                  <p className="text-sm text-muted-foreground">
                    No pending deadlines. Add assignments or parse a WhatsApp
                    export.
                  </p>
                  <Button size="sm" asChild>
                    <Link href="/deadlines">
                      <Plus className="h-4 w-4" /> Add Deadline
                    </Link>
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {data?.upcomingDeadlines.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-glass-border/70 bg-muted/40 p-3.5 hover:border-primary/40 transition-colors"
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
            </CardContent>
          </Card>
        );

      case "schedule":
        return (
          <Card key="schedule" className="h-full flex flex-col">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>
                  {data?.todayEvents.length
                    ? "Today's Lectures & Events"
                    : "Upcoming Schedule"}
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  {data?.todayEvents.length
                    ? `${data.todayEvents.length} scheduled today`
                    : "Next 7 days timetable"}
                </p>
              </div>
              <div className="flex items-center">
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/calendar">
                    Calendar <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
                {reorderControls}
              </div>
            </CardHeader>
            <CardContent className="flex-1">
              {(data?.todayEvents.length
                ? data.todayEvents
                : data?.upcomingEvents
              )?.length === 0 ? (
                <div className="rounded-xl border border-dashed border-glass-border p-8 text-center space-y-3">
                  <CalendarClock className="h-8 w-8 text-muted-foreground mx-auto" />
                  <p className="text-sm text-muted-foreground">
                    No lectures, holidays, or exams scheduled yet.
                  </p>
                  <Button size="sm" variant="outline" asChild>
                    <Link href="/calendar">
                      <CalendarIcon className="h-4 w-4" /> Open Calendar
                    </Link>
                  </Button>
                </div>
              ) : (
                <div className="space-y-2.5 max-h-[340px] overflow-y-auto pr-1">
                  {(data?.todayEvents.length
                    ? data.todayEvents
                    : data?.upcomingEvents || []
                  ).map((ev) => (
                    <div
                      key={ev.occurrenceId || ev.id}
                      className="flex items-start gap-3 rounded-xl border border-glass-border/70 bg-muted/40 p-3"
                    >
                      <div
                        className="w-1 self-stretch rounded-full shrink-0"
                        style={{ backgroundColor: ev.color || "#7C3AED" }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">
                          {ev.title}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {ev.allDay
                            ? `${formatDate(ev.startAt)} • All day`
                            : formatDateTime(ev.startAt)}
                        </p>
                        {ev.location && (
                          <p className="text-xs text-accent mt-0.5 truncate">
                            {ev.location}
                          </p>
                        )}
                      </div>
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        {ev.eventType}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );

      case "subjects":
        return (
          <Card key="subjects" className="h-full flex flex-col">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Subject Progress</CardTitle>
              <div className="flex items-center">
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/progress">
                    Details <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
                {reorderControls}
              </div>
            </CardHeader>
            <CardContent className="flex-1">
              {data?.subjectProgress.length === 0 ? (
                <div className="rounded-xl border border-dashed border-glass-border p-6 text-center space-y-2">
                  <p className="text-sm text-muted-foreground">
                    No subjects added yet.
                  </p>
                  <Button size="sm" variant="outline" asChild>
                    <Link href="/progress">Create First Subject</Link>
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {data?.subjectProgress.map((sub) => (
                    <div key={sub.id} className="space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 font-medium truncate">
                          <span
                            className="h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: sub.color }}
                          />
                          <span className="truncate">{sub.name}</span>
                          {sub.code && (
                            <span className="text-xs text-muted-foreground">
                              ({sub.code})
                            </span>
                          )}
                        </span>
                        <span className="text-xs text-muted-foreground shrink-0 ml-2">
                          {sub.completedTopics}/{sub.totalTopics} (
                          {sub.percentage}%)
                        </span>
                      </div>
                      <Progress value={sub.percentage} />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );

      case "notes":
        return (
          <Card key="notes" className="h-full flex flex-col">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Recent Notes & Modules</CardTitle>
              <div className="flex items-center">
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/notes">
                    All files <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
                {reorderControls}
              </div>
            </CardHeader>
            <CardContent className="flex-1">
              {data?.recentNotes.length === 0 ? (
                <div className="rounded-xl border border-dashed border-glass-border p-6 text-center space-y-2">
                  <p className="text-sm text-muted-foreground">
                    No notes or PPTs uploaded yet.
                  </p>
                  <Button size="sm" variant="outline" asChild>
                    <Link href="/notes">Upload Notes</Link>
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {data?.recentNotes.map((note) => (
                    <div
                      key={note.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-glass-border/70 bg-muted/40 p-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-9 w-9 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                          <FileText className="h-4 w-4 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">
                            {note.title}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {formatFileSize(note.fileSize)} •{" "}
                            {note.subject?.name || "General"}
                          </p>
                        </div>
                      </div>
                      <Button variant="ghost" size="icon" asChild>
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
            </CardContent>
          </Card>
        );

      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      >
        <div>
          <StudyHeroEmblem icon={Flame} eyebrow="Command Center" accentColor="violet" />
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCustomizeMode(!customizeMode)}
          >
            <SlidersHorizontal className="h-4 w-4" />
            {customizeMode ? "Done Reordering" : "Reorder"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={runAiPrioritize}
            disabled={prioritizing}
          >
            {prioritizing ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            ) : (
              <Sparkles className="h-4 w-4 text-primary" />
            )}
            AI Prioritize
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/pomodoro">
              <Clock className="h-4 w-4 text-primary" />
              Focus
            </Link>
          </Button>
          <Button variant="glow" size="sm" asChild>
            <Link href="/deadlines">
              <Plus className="h-4 w-4" />
              Deadline
            </Link>
          </Button>
        </div>
      </motion.div>

      {/* AI Priority Briefing Banner */}
      {aiBriefing && (
        <Card className="border-primary/40 bg-primary/10 p-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-lg bg-primary/25 flex items-center justify-center shrink-0">
                <Bot className="h-4 w-4 text-primary" />
              </div>
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-accent">
                    AI Focus Briefing
                  </span>
                  {aiBriefing.reason && (
                    <Badge variant="default" className="text-[10px]">
                      {aiBriefing.reason}
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-foreground">{aiBriefing.summary}</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" asChild className="shrink-0">
              <Link href="/chat">
                Ask AI Tutor <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </Card>
      )}

      {/* Symmetrical Top 4 Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-stretch">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="h-full"
        >
          <Card className="h-full flex flex-col justify-between p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Pending Deadlines
              </span>
              <div className="h-9 w-9 rounded-lg bg-fuchsia-500/15 flex items-center justify-center shrink-0">
                <Target className="h-4 w-4 text-fuchsia-400" />
              </div>
            </div>
            <p className="text-3xl font-bold my-2">
              {stats?.pendingDeadlines ?? 0}
            </p>
            <Link
              href="/deadlines"
              className="inline-flex items-center gap-1 text-xs text-accent hover:text-primary transition-colors"
            >
              Manage deadlines <ArrowRight className="h-3 w-3" />
            </Link>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="h-full"
        >
          <Card className="h-full flex flex-col justify-between p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Focus Today
              </span>
              <div className="h-9 w-9 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                <Flame className="h-4 w-4 text-primary" />
              </div>
            </div>
            <p className="text-3xl font-bold my-2">
              {stats?.todayFocusMinutes ?? 0}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                min
              </span>
            </p>
            <Link
              href="/pomodoro"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-accent transition-colors"
            >
              {stats?.todaySessionsCount ?? 0} sessions today{" "}
              <ArrowRight className="h-3 w-3" />
            </Link>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="h-full"
        >
          <Card className="h-full flex flex-col justify-between p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Syllabus Covered
              </span>
              <div className="h-9 w-9 rounded-lg bg-emerald-500/15 flex items-center justify-center shrink-0">
                <BarChart3 className="h-4 w-4 text-emerald-400" />
              </div>
            </div>
            <p className="text-3xl font-bold my-2">
              {stats?.overallProgress ?? 0}%
            </p>
            <Link
              href="/progress"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-accent transition-colors"
            >
              {stats?.completedTopics ?? 0}/{stats?.totalTopics ?? 0} topics
              done <ArrowRight className="h-3 w-3" />
            </Link>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="h-full"
        >
          <Card className="h-full flex flex-col justify-between p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Notes Vault
              </span>
              <div className="h-9 w-9 rounded-lg bg-indigo-500/15 flex items-center justify-center shrink-0">
                <FileText className="h-4 w-4 text-indigo-400" />
              </div>
            </div>
            <p className="text-3xl font-bold my-2">{stats?.notesCount ?? 0}</p>
            <Link
              href="/notes"
              className="inline-flex items-center gap-1 text-xs text-accent hover:text-primary transition-colors"
            >
              Across {stats?.subjectsCount ?? 0} subjects{" "}
              <ArrowRight className="h-3 w-3" />
            </Link>
          </Card>
        </motion.div>
      </div>

      {/* Rearrangeable / AI-Prioritized Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        {cardOrder.map((key, idx) => renderSectionCard(key, idx))}
      </div>
    </div>
  );
}
