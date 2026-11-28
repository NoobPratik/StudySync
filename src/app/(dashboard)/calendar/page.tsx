"use client";

import { useEffect, useState, useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { motion } from "framer-motion";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
  addDays,
  subDays,
} from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Calendar as CalendarIcon,
  MapPin,
  Trash2,
  Edit2,
  Clock,
  Repeat,
  Ban,
  Upload,
  Sparkles,
  Loader2,
  CheckSquare,
  Square,
  Zap,
} from "lucide-react";
import { StudyHeroEmblem } from "@/components/ui/study-emblem";
import { AiLogsButton } from "@/components/ui/ai-logs-dialog";
import { useBackgroundAi } from "@/components/background-extraction-provider";
import { useElapsedSeconds } from "@/hooks/use-elapsed-timer";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { cn, getEventTypeColor } from "@/lib/utils";
import { getBrowserTimeZone, getShortTimeZoneName } from "@/lib/timezone";
import { DateInputDDMMYYYY } from "@/components/ui/date-input";
import { AiDebugPanel } from "@/components/ui/ai-debug-panel";
import { readSseStream } from "@/lib/sse-client";

interface RecurrenceRule {
  frequency: "NONE" | "DAILY" | "WEEKLY";
  daysOfWeek?: number[];
  until?: string | null;
  exDates?: string[];
}

interface CalendarEvent {
  id: string;
  occurrenceId?: string;
  title: string;
  description: string | null;
  eventType: "LECTURE" | "HOLIDAY" | "EXAM" | "LAB" | "CUSTOM";
  startAt: string;
  endAt: string;
  allDay: boolean;
  isRecurring?: boolean;
  recurrence?: RecurrenceRule | null;
  color: string | null;
  location: string | null;
}

interface RawCalendarEvent {
  id: string;
  title: string;
  description: string | null;
  eventType: "LECTURE" | "HOLIDAY" | "EXAM" | "LAB" | "CUSTOM";
  startAt: string;
  endAt: string;
  allDay: boolean;
  recurrence: string | null;
  color: string | null;
  location: string | null;
}

const EVENT_TYPES = [
  { value: "ALL", label: "All Types" },
  { value: "LECTURE", label: "Lecture" },
  { value: "LAB", label: "Lab" },
  { value: "EXAM", label: "Exam" },
  { value: "HOLIDAY", label: "Holiday" },
  { value: "CUSTOM", label: "Custom" },
];

const WEEKDAYS = [
  { day: 1, label: "Mon" },
  { day: 2, label: "Tue" },
  { day: 3, label: "Wed" },
  { day: 4, label: "Thu" },
  { day: 5, label: "Fri" },
  { day: 6, label: "Sat" },
  { day: 0, label: "Sun" },
];

interface ParsedTimetableRow {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  title: string;
  eventType: "LECTURE" | "LAB" | "CUSTOM";
  location: string;
  description: string;
  recommended: boolean;
  tag: string;
  include: boolean;
}

const DOW_LABELS: Record<number, string> = {
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
  0: "Sun",
};

const COURSE_PALETTE = [
  { border: "#8B5CF6", bg: "rgba(139, 92, 246, 0.14)", text: "#DDD6FE" }, // Violet
  { border: "#3B82F6", bg: "rgba(59, 130, 246, 0.14)", text: "#BFDBFE" }, // Blue
  { border: "#10B981", bg: "rgba(16, 185, 129, 0.14)", text: "#A7F3D0" }, // Emerald
  { border: "#EC4899", bg: "rgba(236, 72, 153, 0.14)", text: "#FBCFE8" }, // Pink
  { border: "#06B6D4", bg: "rgba(6, 182, 212, 0.14)", text: "#A5F3FC" },  // Cyan
  { border: "#6366F1", bg: "rgba(99, 102, 241, 0.14)", text: "#C7D2FE" }, // Indigo
  { border: "#F59E0B", bg: "rgba(245, 158, 11, 0.14)", text: "#FDE68A" }, // Amber
  { border: "#14B8A6", bg: "rgba(20, 184, 166, 0.14)", text: "#99F6E4" }, // Teal
];

function getEventPalette(ev: CalendarEvent) {
  if (ev.eventType === "LAB") {
    return { border: "#F59E0B", bg: "rgba(245, 158, 11, 0.16)", text: "#FDE68A" };
  }
  if (ev.eventType === "EXAM") {
    return { border: "#EF4444", bg: "rgba(239, 68, 68, 0.18)", text: "#FECACA" };
  }
  if (ev.eventType === "HOLIDAY") {
    return { border: "#10B981", bg: "rgba(16, 185, 129, 0.16)", text: "#A7F3D0" };
  }
  const key = ev.title.replace(/\s*\(.*?\)/g, "").trim().toUpperCase();
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return COURSE_PALETTE[hash % COURSE_PALETTE.length];
}

function formatCompactTimeRange(startIso: string, endIso: string): string {
  const s = new Date(startIso);
  const e = new Date(endIso);
  const sStr = format(s, "h:mm");
  const sAmPm = format(s, "a");
  const eStr = format(e, "h:mm");
  const eAmPm = format(e, "a");
  if (sAmPm === eAmPm) {
    return `${sStr}–${eStr} ${eAmPm}`;
  }
  return `${sStr} ${sAmPm}–${eStr} ${eAmPm}`;
}

const HOUR_ROW_HEIGHT = 82; // px per hour on the time grid so 50-min classes comfortably fit title + time
const subscribeNoop = () => () => { };

type ViewMode = "WEEK" | "MONTH" | "DAY";

export default function CalendarPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("WEEK");
  const [weekLayout, setWeekLayout] = useState<"GRID" | "LIST">("GRID");
  const [weekendPref, setWeekendPref] = useState<"AUTO" | "SHOW" | "HIDE">("AUTO");
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [rawEvents, setRawEvents] = useState<RawCalendarEvent[]>([]);
  const [filterType, setFilterType] = useState("ALL");
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset / Mass delete state
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [clearScope, setClearScope] = useState<"recurring" | "all" | "selected">("recurring");
  const [selectedClearIds, setSelectedClearIds] = useState<string[]>([]);
  const [clearing, setClearing] = useState(false);
  const tzLabel = useSyncExternalStore(
    subscribeNoop,
    () => getShortTimeZoneName(getBrowserTimeZone()),
    () => "IST",
  );

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [eventType, setEventType] =
    useState<CalendarEvent["eventType"]>("LECTURE");
  const [dateStr, setDateStr] = useState(() =>
    format(new Date(), "yyyy-MM-dd"),
  );
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("09:00");
  const [allDay, setAllDay] = useState(false);
  const [location, setLocation] = useState("");

  // Recurrence state
  const [freq, setFreq] = useState<"NONE" | "DAILY" | "WEEKLY">("NONE");
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([
    new Date().getDay(),
  ]);
  const [repeatUntil, setRepeatUntil] = useState("");

  // Timetable Import Studio state
  const ttFileRef = useRef<HTMLInputElement>(null);
  const ttAbortRef = useRef<AbortController | null>(null);
  const { upsertExternalTask, dismissAiTask } = useBackgroundAi();
  const [ttOpen, setTtOpen] = useState(false);
  const [ttFile, setTtFile] = useState<File | null>(null);
  const [ttPreviewUrl, setTtPreviewUrl] = useState<string | null>(null);
  const [ttRawText, setTtRawText] = useState("");
  const [ttRepeatUntil, setTtRepeatUntil] = useState("");
  const [ttFastMode, setTtFastMode] = useState(true);
  const [ttParsing, setTtParsing] = useState(false);
  const [ttImporting, setTtImporting] = useState(false);
  const [ttRows, setTtRows] = useState<ParsedTimetableRow[]>([]);
  const [ttDebugMeta, setTtDebugMeta] = useState<{
    model?: string;
    mode?: string;
    timeoutSeconds?: number;
    debugMode?: boolean;
  } | null>(null);
  const [ttStreamThinking, setTtStreamThinking] = useState("");
  const [ttStreamOutput, setTtStreamOutput] = useState("");
  const [ttStreamError, setTtStreamError] = useState<string | null>(null);
  const ttElapsed = useElapsedSeconds(ttParsing);

  const ttPreviewUrlRef = useRef<string | null>(null);

  function selectTimetableFile(file: File | null) {
    if (ttPreviewUrlRef.current) {
      URL.revokeObjectURL(ttPreviewUrlRef.current);
      ttPreviewUrlRef.current = null;
    }
    setTtFile(file);
    if (file) {
      const url = URL.createObjectURL(file);
      ttPreviewUrlRef.current = url;
      setTtPreviewUrl(url);
    } else {
      setTtPreviewUrl(null);
    }
  }

  useEffect(() => {
    return () => {
      if (ttPreviewUrlRef.current) {
        URL.revokeObjectURL(ttPreviewUrlRef.current);
      }
    };
  }, []);

  const range = useMemo(() => {
    const start = startOfWeek(startOfMonth(anchorDate), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(anchorDate), { weekStartsOn: 1 });
    return { start, end };
  }, [anchorDate]);

  const fetchEvents = useCallback(async () => {
    try {
      const qs = new URLSearchParams({
        start: range.start.toISOString(),
        end: range.end.toISOString(),
        tz: getBrowserTimeZone(),
      });
      const res = await fetch(`/api/calendar?${qs.toString()}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setEvents(data.events || []);
      setRawEvents(data.rawEvents || []);
    } catch {
      toast.error("Failed to load calendar events");
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    let active = true;
    const qs = new URLSearchParams({
      start: range.start.toISOString(),
      end: range.end.toISOString(),
      tz: getBrowserTimeZone(),
    });
    fetch(`/api/calendar?${qs.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((data) => {
        if (!active) return;
        setEvents(data.events || []);
        setRawEvents(data.rawEvents || []);
      })
      .catch(() => {
        if (active) toast.error("Failed to load calendar events");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [range]);

  const weekDays = useMemo(() => {
    const start = startOfWeek(anchorDate, { weekStartsOn: 1 });
    const end = endOfWeek(anchorDate, { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [anchorDate]);

  const monthDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(anchorDate), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(anchorDate), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [anchorDate]);

  const filteredEvents = useMemo(() => {
    if (filterType === "ALL") return events;
    return events.filter((e) => e.eventType === filterType);
  }, [events, filterType]);

  const selectedDayEvents = useMemo(() => {
    return filteredEvents.filter((e) =>
      isSameDay(new Date(e.startAt), selectedDate),
    );
  }, [filteredEvents, selectedDate]);

  const hasWeekendEvents = useMemo(() => {
    return weekDays.slice(5).some((d) =>
      filteredEvents.some((e) => isSameDay(new Date(e.startAt), d)),
    );
  }, [weekDays, filteredEvents]);

  const visibleWeekDays = useMemo(() => {
    const showSatSun =
      weekendPref === "SHOW" || (weekendPref === "AUTO" && hasWeekendEvents);
    return showSatSun ? weekDays : weekDays.slice(0, 5);
  }, [weekDays, weekendPref, hasWeekendEvents]);

  const timeGridBounds = useMemo(() => {
    let minHour = 8;
    let maxHour = 17;
    for (const d of visibleWeekDays) {
      for (const ev of filteredEvents) {
        if (ev.allDay || !isSameDay(new Date(ev.startAt), d)) continue;
        const s = new Date(ev.startAt);
        const e = new Date(ev.endAt);
        minHour = Math.min(minHour, s.getHours());
        maxHour = Math.max(maxHour, e.getHours() + (e.getMinutes() > 0 ? 1 : 0));
      }
    }
    const startHour = Math.max(6, minHour);
    const endHour = Math.min(22, Math.max(startHour + 6, maxHour));
    const hours: number[] = [];
    for (let h = startHour; h <= endHour; h++) hours.push(h);
    return { startHour, endHour, hours };
  }, [visibleWeekDays, filteredEvents]);

  function openNewDialog(date?: Date) {
    const target = date || selectedDate;
    setEditingId(null);
    setTitle("");
    setDescription("");
    setEventType("LECTURE");
    setDateStr(format(target, "yyyy-MM-dd"));
    setStartTime("08:00");
    setEndTime("09:00");
    setAllDay(false);
    setLocation("");
    setFreq("NONE");
    setDaysOfWeek([target.getDay()]);
    setRepeatUntil("");
    setDialogOpen(true);
  }

  function openEditSeries(eventId: string) {
    const raw = rawEvents.find((r) => r.id === eventId);
    if (!raw) return;
    const start = new Date(raw.startAt);
    const end = new Date(raw.endAt);
    setEditingId(raw.id);
    setTitle(raw.title);
    setDescription(raw.description || "");
    setEventType(raw.eventType);
    setDateStr(format(start, "yyyy-MM-dd"));
    setStartTime(format(start, "HH:mm"));
    setEndTime(format(end, "HH:mm"));
    setAllDay(raw.allDay);
    setLocation(raw.location || "");

    if (raw.recurrence) {
      try {
        const parsed = JSON.parse(raw.recurrence) as RecurrenceRule;
        setFreq(parsed.frequency || "NONE");
        setDaysOfWeek(parsed.daysOfWeek || [start.getDay()]);
        setRepeatUntil(parsed.until ? parsed.until.slice(0, 10) : "");
      } catch {
        setFreq("NONE");
      }
    } else {
      setFreq("NONE");
      setDaysOfWeek([start.getDay()]);
      setRepeatUntil("");
    }
    setDialogOpen(true);
  }

  function toggleWeekday(day: number) {
    setDaysOfWeek((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Please enter an event title");
      return;
    }

    const startAt = allDay
      ? new Date(`${dateStr}T00:00:00`)
      : new Date(`${dateStr}T${startTime}:00`);
    const endAt = allDay
      ? new Date(`${dateStr}T23:59:59`)
      : new Date(`${dateStr}T${endTime}:00`);

    const recurrencePayload =
      freq === "NONE"
        ? null
        : {
          frequency: freq,
          daysOfWeek:
            freq === "WEEKLY"
              ? daysOfWeek.length > 0
                ? daysOfWeek
                : [startAt.getDay()]
              : undefined,
          until: repeatUntil || null,
        };

    setSubmitting(true);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        eventType,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        allDay,
        location: location.trim() || null,
        color: getEventTypeColor(eventType),
        recurrence: recurrencePayload,
      };

      const res = await fetch(
        editingId ? `/api/calendar/${editingId}` : "/api/calendar",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!res.ok) throw new Error();
      toast.success(editingId ? "Event series updated" : "Event created");
      setDialogOpen(false);
      fetchEvents();
    } catch {
      toast.error("Failed to save event");
    } finally {
      setSubmitting(false);
    }
  }

  async function skipOccurrence(eventId: string, occStartAt: string) {
    const skipDate = format(new Date(occStartAt), "yyyy-MM-dd");
    try {
      const res = await fetch(`/api/calendar/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skipDate }),
      });
      if (!res.ok) throw new Error();
      toast.success(`Skipped occurrence on ${skipDate}`);
      fetchEvents();
    } catch {
      toast.error("Could not skip occurrence");
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/calendar/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Event deleted");
      fetchEvents();
    } catch {
      toast.error("Failed to delete event");
    }
  }

  const recurringRawEvents = useMemo(
    () => rawEvents.filter((r) => Boolean(r.recurrence)),
    [rawEvents],
  );

  function openClearDialog(defaultScope?: "recurring" | "all" | "selected") {
    const fallbackScope =
      recurringRawEvents.length > 0 ? "recurring" : "all";
    setClearScope(defaultScope ?? fallbackScope);
    setSelectedClearIds(rawEvents.map((r) => r.id));
    setClearDialogOpen(true);
  }

  async function handleClearCalendar() {
    if (clearScope === "selected" && selectedClearIds.length === 0) {
      toast.error("Select at least one series to delete");
      return;
    }
    setClearing(true);
    try {
      const res = await fetch("/api/calendar", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: clearScope,
          ids: clearScope === "selected" ? selectedClearIds : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to clear calendar");
      toast.success(
        `Deleted ${json.deletedCount} calendar series`,
      );
      setClearDialogOpen(false);
      fetchEvents();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to clear calendar",
      );
    } finally {
      setClearing(false);
    }
  }

  async function handleParseTimetable(e: React.FormEvent) {
    e.preventDefault();
    if (!ttFile && !ttRawText.trim()) {
      toast.error("Upload your timetable screenshot/PDF or paste text first");
      return;
    }
    ttAbortRef.current?.abort();
    const ac = new AbortController();
    ttAbortRef.current = ac;
    setTtParsing(true);
    setTtStreamThinking("");
    setTtStreamOutput("");
    setTtStreamError(null);
    setTtDebugMeta(null);

    const taskId = "timetable-parse";
    upsertExternalTask(
      {
        id: taskId,
        feature: "timetable_extract",
        title: "Smart Timetable Importer",
        subtitle: `Scanning ${ttFile ? ttFile.name : "pasted schedule"}...`,
        status: "running",
        actionLabel: "Review Slots",
        onOpenResult: () => setTtOpen(true),
      },
      () => ac.abort(),
    );

    try {
      const fd = new FormData();
      if (ttFile) fd.append("file", ttFile);
      if (ttRawText.trim()) fd.append("text", ttRawText.trim());
      fd.append("stream", "true");
      if (ttFastMode) fd.append("fastMode", "true");

      const res = await fetch("/api/ai/timetable", {
        method: "POST",
        body: fd,
        signal: ac.signal,
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Could not parse timetable");
      }

      let extractedEntries: Array<Omit<ParsedTimetableRow, "include">> = [];

      await readSseStream<
        {
          model?: string;
          mode?: string;
          timeoutSeconds?: number;
          debugMode?: boolean;
        },
        { entries?: Array<Omit<ParsedTimetableRow, "include">>; model?: string; elapsedSeconds?: number }
      >(res, {
        onMeta: (meta) => setTtDebugMeta(meta),
        onThinking: (txt) => setTtStreamThinking((prev) => prev + txt),
        onToken: (tok) => setTtStreamOutput((prev) => prev + tok),
        onDone: (done) => {
          extractedEntries = done.entries || [];
        },
        onError: (msg) => {
          setTtStreamError(msg);
        },
      });

      if (extractedEntries.length === 0) {
        upsertExternalTask({
          id: taskId,
          feature: "timetable_extract",
          title: "Smart Timetable Importer",
          subtitle: "No class slots detected",
          status: "done",
          actionLabel: "Inspect",
          onOpenResult: () => setTtOpen(true),
        });
        toast.info(
          "No class slots detected — inspect the Live AI Log below or try a clearer image.",
        );
        return;
      }

      setTtRows(
        extractedEntries.map((entry) => ({
          ...entry,
          include: entry.recommended !== false,
        })),
      );
      upsertExternalTask({
        id: taskId,
        feature: "timetable_extract",
        title: "Smart Timetable Importer",
        subtitle: `Found ${extractedEntries.length} class slots ready to review`,
        status: "done",
        actionLabel: "Review Slots",
        onOpenResult: () => setTtOpen(true),
      });
      toast.success(
        `Detected ${extractedEntries.length} timetable slot(s)! Review and uncheck any that don't apply.`,
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        upsertExternalTask({
          id: taskId,
          feature: "timetable_extract",
          title: "Smart Timetable Importer",
          subtitle: "Stopped by user",
          status: "stopped",
        });
        toast.info("Timetable scan stopped");
      } else {
        const msg =
          err instanceof Error ? err.message : "Timetable extraction failed";
        setTtStreamError(msg);
        upsertExternalTask({
          id: taskId,
          feature: "timetable_extract",
          title: "Smart Timetable Importer",
          subtitle: "Scan failed",
          status: "error",
          errorText: msg,
        });
        toast.error(msg);
      }
    } finally {
      ttAbortRef.current = null;
      setTtParsing(false);
    }
  }

  function stopTimetableParse() {
    ttAbortRef.current?.abort();
  }

  async function handleImportSelectedTimetable() {
    const selected = ttRows.filter((r) => r.include && r.title.trim());
    if (selected.length === 0) {
      toast.error("Select at least one class to import");
      return;
    }
    setTtImporting(true);
    try {
      const res = await fetch("/api/calendar/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: format(new Date(), "yyyy-MM-dd"),
          timeZone: getBrowserTimeZone(),
          items: selected.map((r) => ({
            title: r.title.trim(),
            description: r.description?.trim() || null,
            eventType: r.eventType,
            dayOfWeek: r.dayOfWeek,
            startTime: r.startTime,
            endTime: r.endTime,
            location: r.location?.trim() || null,
            repeatUntil: ttRepeatUntil || null,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Bulk import failed");
      toast.success(
        `Imported ${json.createdCount} weekly classes into your Calendar!`,
      );
      setTtOpen(false);
      setTtRows([]);
      selectTimetableFile(null);
      setTtRawText("");
      dismissAiTask("timetable-parse");
      fetchEvents();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to import");
    } finally {
      setTtImporting(false);
    }
  }

  function stepRange(dir: -1 | 1) {
    if (viewMode === "WEEK") {
      setAnchorDate((d) => (dir === 1 ? addWeeks(d, 1) : subWeeks(d, 1)));
    } else if (viewMode === "MONTH") {
      setAnchorDate((d) => (dir === 1 ? addMonths(d, 1) : subMonths(d, 1)));
    } else {
      const next = dir === 1 ? addDays(selectedDate, 1) : subDays(selectedDate, 1);
      setSelectedDate(next);
      setAnchorDate(next);
    }
  }

  const headerTitle =
    viewMode === "WEEK"
      ? `${format(weekDays[0], "MMM d")} – ${format(weekDays[6], "MMM d, yyyy")}`
      : viewMode === "MONTH"
        ? format(anchorDate, "MMMM yyyy")
        : format(selectedDate, "EEEE, d MMMM yyyy");

  const dayGridBounds = useMemo(() => {
    let minHour = 8;
    let maxHour = 17;
    for (const ev of selectedDayEvents) {
      if (ev.allDay) continue;
      const s = new Date(ev.startAt);
      const e = new Date(ev.endAt);
      minHour = Math.min(minHour, s.getHours());
      maxHour = Math.max(maxHour, e.getHours() + (e.getMinutes() > 0 ? 1 : 0));
    }
    const startHour = Math.max(6, minHour);
    const endHour = Math.min(22, Math.max(startHour + 6, maxHour));
    const hours: number[] = [];
    for (let h = startHour; h <= endHour; h++) hours.push(h);
    return { startHour, endHour, hours };
  }, [selectedDayEvents]);

  const [nowMs, setNowMs] = useState<number>(0);
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    const init = setTimeout(tick, 0);
    const id = setInterval(tick, 30000);
    return () => {
      clearTimeout(init);
      clearInterval(id);
    };
  }, []);

  const nowDate = useMemo(
    () => (nowMs > 0 ? new Date(nowMs) : null),
    [nowMs],
  );
  const isSelectedToday = nowDate ? isSameDay(selectedDate, nowDate) : false;
  const nextOrCurrentTodayEvent = useMemo(() => {
    const todaySorted = [...selectedDayEvents]
      .filter((e) => !e.allDay)
      .sort(
        (a, b) =>
          new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
      );
    if (nowMs <= 0) return todaySorted[0] || null;
    return (
      todaySorted.find(
        (e) =>
          new Date(e.startAt).getTime() <= nowMs &&
          new Date(e.endAt).getTime() > nowMs,
      ) ||
      todaySorted.find((e) => new Date(e.startAt).getTime() > nowMs) ||
      todaySorted[0] ||
      null
    );
  }, [selectedDayEvents, nowMs]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-end justify-between gap-4"
      >
        <div>
          <StudyHeroEmblem icon={CalendarIcon} eyebrow="Weekly Schedule" accentColor="indigo" />
          <h1 className="text-2xl sm:text-3xl font-bold">
            Academic <span className="gradient-text">Calendar</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Weekly recurring timetables, proportional daily timeline, holidays,
            and exams
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <AiLogsButton size="sm" variant="outline" className="h-10" />
          {rawEvents.length > 0 && (
            <Button
              variant="outline"
              onClick={() => openClearDialog()}
              className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
              Reset / Clear ({rawEvents.length})
            </Button>
          )}
          <Button variant="outline" onClick={() => setTtOpen(true)}>
            <Upload className="h-4 w-4 text-primary" />
            Import Timetable
          </Button>
          <Button variant="glow" onClick={() => openNewDialog()}>
            <Plus className="h-4 w-4" />
            Add Event / Lecture
          </Button>
        </div>
      </motion.div>

      {/* Unified Toolbar Strip (curved studio shell) */}
      <div className="studio-shell p-3 sm:px-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg bg-muted p-1 gap-1">
            {(["WEEK", "MONTH", "DAY"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={cn(
                  "px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer",
                  viewMode === mode
                    ? "bg-primary text-white shadow"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {mode === "WEEK"
                  ? "Week Timetable"
                  : mode === "MONTH"
                    ? "Month"
                    : "Day"}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5 ml-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const today = new Date();
                setAnchorDate(today);
                setSelectedDate(today);
              }}
            >
              Today
            </Button>
            <Button variant="outline" size="icon" onClick={() => stepRange(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={() => stepRange(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <span className="text-sm font-semibold ml-2">{headerTitle}</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {viewMode === "WEEK" && (
            <>
              <div className="inline-flex rounded-lg bg-muted p-0.5 border border-glass-border mr-1">
                <button
                  type="button"
                  onClick={() => setWeekLayout("GRID")}
                  className={cn(
                    "px-2.5 py-1 rounded-md text-[11px] font-medium cursor-pointer transition-all",
                    weekLayout === "GRID"
                      ? "bg-primary text-white shadow"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Time Grid
                </button>
                <button
                  type="button"
                  onClick={() => setWeekLayout("LIST")}
                  className={cn(
                    "px-2.5 py-1 rounded-md text-[11px] font-medium cursor-pointer transition-all",
                    weekLayout === "LIST"
                      ? "bg-primary text-white shadow"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Cards
                </button>
              </div>
              <button
                type="button"
                onClick={() =>
                  setWeekendPref(visibleWeekDays.length > 5 ? "HIDE" : "SHOW")
                }
                className="px-2.5 py-1 rounded-lg text-[11px] font-medium border border-glass-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors cursor-pointer mr-1"
                title="Show or hide Saturday & Sunday columns"
              >
                {visibleWeekDays.length > 5 ? "Mon–Sun (7d)" : "Mon–Fri (5d)"}
              </button>
            </>
          )}
          {EVENT_TYPES.map((t) => (
            <button
              key={t.value}
              onClick={() => setFilterType(t.value)}
              className={cn(
                "px-2.5 py-1 rounded-lg text-xs font-medium border transition-all cursor-pointer",
                filterType === t.value
                  ? "bg-primary/20 border-primary/50 text-primary"
                  : "border-glass-border text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* WEEK TIMETABLE VIEW */}
      {viewMode === "WEEK" && (
        <>
          {/* Proportional Time-Grid on Desktop (md+) when GRID is active */}
          {weekLayout === "GRID" && (
            <Card className="hidden md:block p-0 overflow-hidden border-glass-border/90">
              {/* Column Headers */}
              <div
                className="grid border-b border-glass-border/70 bg-muted/35"
                style={{
                  gridTemplateColumns: `68px repeat(${visibleWeekDays.length}, minmax(0, 1fr))`,
                }}
              >
                <div className="py-3 px-2 text-[11px] font-medium text-muted-foreground text-center border-r border-glass-border/50 flex items-center justify-center">
                  {tzLabel}
                </div>
                {visibleWeekDays.map((day) => {
                  const isToday = isSameDay(day, new Date());
                  const dayCount = filteredEvents.filter((e) =>
                    isSameDay(new Date(e.startAt), day),
                  ).length;
                  return (
                    <div
                      key={day.toISOString()}
                      className={cn(
                        "py-2.5 px-3 border-r last:border-r-0 border-glass-border/50 flex items-center justify-between gap-2 transition-colors",
                        isToday && "bg-primary/10",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedDate(day)}
                        className="flex items-center gap-2 text-left cursor-pointer min-w-0"
                      >
                        <span
                          className={cn(
                            "h-8 w-8 rounded-lg flex items-center justify-center text-sm font-bold shrink-0",
                            isToday
                              ? "bg-primary text-white shadow-md shadow-primary/30"
                              : "bg-muted/70 text-foreground",
                          )}
                        >
                          {format(day, "d")}
                        </span>
                        <div className="min-w-0">
                          <p
                            className={cn(
                              "text-xs font-semibold uppercase tracking-wider leading-tight",
                              isToday ? "text-primary" : "text-foreground",
                            )}
                          >
                            {format(day, "EEE")}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {dayCount === 0 ? "Free" : `${dayCount} classes`}
                          </p>
                        </div>
                      </button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 opacity-70 hover:opacity-100"
                        onClick={() => openNewDialog(day)}
                        title={`Add class on ${format(day, "EEE MMM d")}`}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  );
                })}
              </div>

              {/* All-day Holiday / Notice Strip */}
              {visibleWeekDays.some((d) =>
                filteredEvents.some(
                  (e) => e.allDay && isSameDay(new Date(e.startAt), d),
                ),
              ) && (
                  <div
                    className="grid border-b border-glass-border/60 bg-background/40"
                    style={{
                      gridTemplateColumns: `68px repeat(${visibleWeekDays.length}, minmax(0, 1fr))`,
                    }}
                  >
                    <div className="py-1.5 px-2 text-[10px] text-muted-foreground text-center border-r border-glass-border/40 flex items-center justify-center">
                      All Day
                    </div>
                    {visibleWeekDays.map((day) => {
                      const allDayEvs = filteredEvents.filter(
                        (e) => e.allDay && isSameDay(new Date(e.startAt), day),
                      );
                      return (
                        <div
                          key={`ad-${day.toISOString()}`}
                          className="p-1.5 border-r last:border-r-0 border-glass-border/40 space-y-1"
                        >
                          {allDayEvs.map((ev) => {
                            const pal = getEventPalette(ev);
                            return (
                              <div
                                key={ev.occurrenceId || ev.id}
                                onClick={() => openEditSeries(ev.id)}
                                className="rounded-md px-2 py-1 text-[11px] font-medium truncate cursor-pointer border"
                                style={{
                                  backgroundColor: pal.bg,
                                  borderColor: `${pal.border}66`,
                                  color: pal.text,
                                }}
                              >
                                {ev.title}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                )}

              {/* Scrollable Proportional Hour Grid */}
              {loading ? (
                <div className="h-[460px] shimmer" />
              ) : (
                <div className="overflow-x-auto">
                  <div
                    className="grid relative select-none"
                    style={{
                      gridTemplateColumns: `68px repeat(${visibleWeekDays.length}, minmax(0, 1fr))`,
                      height: `${(timeGridBounds.endHour - timeGridBounds.startHour) * HOUR_ROW_HEIGHT}px`,
                    }}
                  >
                    {/* Left Hour Labels */}
                    <div className="relative border-r border-glass-border/50 bg-muted/15">
                      {timeGridBounds.hours.slice(0, -1).map((hour, idx) => (
                        <div
                          key={hour}
                          className="absolute left-0 right-0 px-2 text-right pr-2.5 text-[11px] font-medium text-muted-foreground/80"
                          style={{ top: `${idx * HOUR_ROW_HEIGHT + 4}px` }}
                        >
                          {hour === 12
                            ? "12 PM"
                            : hour > 12
                              ? `${hour - 12} PM`
                              : `${hour} AM`}
                        </div>
                      ))}
                    </div>

                    {/* Day Columns */}
                    {visibleWeekDays.map((day) => {
                      const timedEvents = filteredEvents.filter(
                        (e) => !e.allDay && isSameDay(new Date(e.startAt), day),
                      );
                      const isToday = isSameDay(day, new Date());

                      return (
                        <div
                          key={`col-${day.toISOString()}`}
                          className={cn(
                            "relative border-r last:border-r-0 border-glass-border/50",
                            isToday && "bg-primary/[0.03]",
                          )}
                        >
                          {/* Hour + Half-Hour Guide Lines */}
                          {timeGridBounds.hours.slice(0, -1).map((hour, idx) => (
                            <div
                              key={hour}
                              className="absolute left-0 right-0 border-t border-glass-border/35 pointer-events-none"
                              style={{
                                top: `${idx * HOUR_ROW_HEIGHT}px`,
                                height: `${HOUR_ROW_HEIGHT}px`,
                              }}
                            >
                              <div className="w-full border-t border-dashed border-glass-border/15 mt-[34px]" />
                            </div>
                          ))}

                          {/* Timed Event Blocks */}
                          {timedEvents.map((ev) => {
                            const s = new Date(ev.startAt);
                            const e = new Date(ev.endAt);
                            const startMin =
                              (s.getHours() - timeGridBounds.startHour) * 60 +
                              s.getMinutes();
                            const endMin =
                              (e.getHours() - timeGridBounds.startHour) * 60 +
                              e.getMinutes();
                            const durationMin = Math.max(30, endMin - startMin);
                            const topPx = Math.max(
                              2,
                              (startMin / 60) * HOUR_ROW_HEIGHT + 2,
                            );
                            const heightPx = Math.max(
                              36,
                              (durationMin / 60) * HOUR_ROW_HEIGHT - 4,
                            );
                            const pal = getEventPalette(ev);
                            const isVeryShort = heightPx < 46;

                            return (
                              <div
                                key={ev.occurrenceId || ev.id}
                                onClick={() => openEditSeries(ev.id)}
                                className="absolute left-1.5 right-1.5 rounded-xl border px-2.5 py-1.5 overflow-hidden group cursor-pointer transition-all hover:z-20 hover:shadow-lg hover:brightness-110 flex flex-col justify-between"
                                style={{
                                  top: `${topPx}px`,
                                  height: `${heightPx}px`,
                                  backgroundColor: pal.bg,
                                  borderColor: `${pal.border}55`,
                                  borderLeftWidth: "3px",
                                  borderLeftColor: pal.border,
                                }}
                              >
                                <div className="flex items-start justify-between gap-1 min-w-0">
                                  <div className="min-w-0 flex-1">
                                    {isVeryShort ? (
                                      <p className="text-[11px] font-semibold truncate leading-tight" style={{ color: pal.text }}>
                                        {ev.title} <span className="font-normal text-foreground/75">• {formatCompactTimeRange(ev.startAt, ev.endAt)}</span>
                                      </p>
                                    ) : (
                                      <>
                                        <p
                                          className="text-xs font-semibold truncate leading-tight"
                                          style={{ color: pal.text }}
                                        >
                                          {ev.title}
                                        </p>
                                        <p className="text-[11px] text-foreground/75 whitespace-nowrap mt-0.5 leading-tight">
                                          {formatCompactTimeRange(ev.startAt, ev.endAt)}
                                        </p>
                                      </>
                                    )}
                                  </div>

                                  <div
                                    className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 bg-background/80 rounded-md p-0.5 backdrop-blur-sm"
                                    onClick={(evt) => evt.stopPropagation()}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => openEditSeries(ev.id)}
                                      className="p-1 rounded hover:bg-glass-hover text-foreground/80 cursor-pointer"
                                      title="Edit series"
                                    >
                                      <Edit2 className="h-3 w-3" />
                                    </button>
                                    {ev.isRecurring && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          skipOccurrence(ev.id, ev.startAt)
                                        }
                                        className="p-1 rounded hover:bg-glass-hover text-amber-400 cursor-pointer"
                                        title="Skip this day only"
                                      >
                                        <Ban className="h-3 w-3" />
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => handleDelete(ev.id)}
                                      className="p-1 rounded hover:bg-glass-hover text-destructive cursor-pointer"
                                      title="Delete series"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  </div>
                                </div>

                                {heightPx >= 72 && (
                                  <div className="flex items-center justify-between gap-1 text-[10px] text-foreground/65 pt-0.5">
                                    <span className="truncate">
                                      {ev.location || ev.eventType}
                                    </span>
                                    {ev.isRecurring && (
                                      <Repeat className="h-2.5 w-2.5 shrink-0 opacity-75" />
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </Card>
          )}

          {/* Clean Color-Coded Card Columns (Used on mobile OR when user toggles "Cards") */}
          <div
            className={cn(
              "grid gap-3 items-stretch",
              weekLayout === "GRID" ? "grid-cols-1 md:hidden" : "grid-cols-1 sm:grid-cols-2",
              weekLayout === "LIST" &&
              (visibleWeekDays.length <= 5 ? "lg:grid-cols-5" : "lg:grid-cols-7"),
            )}
          >
            {visibleWeekDays.map((day) => {
              const dayEvents = filteredEvents.filter((e) =>
                isSameDay(new Date(e.startAt), day),
              );
              const isToday = isSameDay(day, new Date());
              const isSelected = isSameDay(day, selectedDate);

              return (
                <Card
                  key={day.toISOString()}
                  className={cn(
                    "p-3.5 flex flex-col min-h-[240px]",
                    isToday && "border-primary/60 glow-purple",
                    isSelected && !isToday && "border-accent/50",
                  )}
                >
                  <div className="flex items-center justify-between pb-2.5 mb-3 border-b border-glass-border/60">
                    <button
                      onClick={() => setSelectedDate(day)}
                      className="flex items-center gap-2 text-left cursor-pointer"
                    >
                      <span
                        className={cn(
                          "h-7 w-7 rounded-lg flex items-center justify-center text-sm font-bold",
                          isToday
                            ? "bg-primary text-white"
                            : "bg-muted text-foreground",
                        )}
                      >
                        {format(day, "d")}
                      </span>
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {format(day, "EEE")}
                      </span>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => openNewDialog(day)}
                      title={`Add event on ${format(day, "EEE MMM d")}`}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  <div className="space-y-2 flex-1">
                    {loading ? (
                      <div className="h-24 rounded-lg shimmer" />
                    ) : dayEvents.length === 0 ? (
                      <p className="text-xs text-muted-foreground/70 text-center pt-6">
                        No classes scheduled
                      </p>
                    ) : (
                      dayEvents.map((ev) => {
                        const pal = getEventPalette(ev);
                        return (
                          <div
                            key={ev.occurrenceId || ev.id}
                            onClick={() => openEditSeries(ev.id)}
                            className="rounded-xl border p-2.5 space-y-1 group cursor-pointer transition-all hover:brightness-110"
                            style={{
                              backgroundColor: pal.bg,
                              borderColor: `${pal.border}55`,
                              borderLeftWidth: "3px",
                              borderLeftColor: pal.border,
                            }}
                          >
                            <div className="flex items-start justify-between gap-1.5">
                              <p
                                className="text-xs font-semibold leading-snug"
                                style={{ color: pal.text }}
                              >
                                {ev.title}
                              </p>
                              {ev.isRecurring && (
                                <Repeat
                                  className="h-3 w-3 shrink-0 mt-0.5 opacity-75"
                                  aria-label="Recurring weekly"
                                />
                              )}
                            </div>
                            <p className="text-[11px] text-foreground/80 whitespace-nowrap">
                              {ev.allDay
                                ? "All Day"
                                : formatCompactTimeRange(ev.startAt, ev.endAt)}
                            </p>
                            {ev.location && (
                              <p className="text-[10px] text-foreground/65 truncate">
                                {ev.location}
                              </p>
                            )}
                            <div
                              className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity pt-0.5"
                              onClick={(evt) => evt.stopPropagation()}
                            >
                              <button
                                onClick={() => openEditSeries(ev.id)}
                                className="p-1 rounded hover:bg-glass-hover text-muted-foreground hover:text-foreground cursor-pointer"
                                title="Edit"
                              >
                                <Edit2 className="h-3 w-3" />
                              </button>
                              {ev.isRecurring && (
                                <button
                                  onClick={() =>
                                    skipOccurrence(ev.id, ev.startAt)
                                  }
                                  className="p-1 rounded hover:bg-glass-hover text-muted-foreground hover:text-warning cursor-pointer"
                                  title="Skip this day only"
                                >
                                  <Ban className="h-3 w-3" />
                                </button>
                              )}
                              <button
                                onClick={() => handleDelete(ev.id)}
                                className="p-1 rounded hover:bg-glass-hover text-muted-foreground hover:text-destructive cursor-pointer"
                                title="Delete series"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {/* MONTH VIEW */}
      {viewMode === "MONTH" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2">
            <CardContent className="pt-0">
              {loading ? (
                <div className="h-[460px] rounded-xl shimmer" />
              ) : (
                <div>
                  <div className="grid grid-cols-7 gap-1 mb-2 text-center text-xs font-medium text-muted-foreground">
                    {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
                      (day) => (
                        <div key={day} className="py-2">
                          {day}
                        </div>
                      ),
                    )}
                  </div>
                  <div className="grid grid-cols-7 gap-1.5">
                    {monthDays.map((day) => {
                      const dayEvents = filteredEvents.filter((e) =>
                        isSameDay(new Date(e.startAt), day),
                      );
                      const isSelected = isSameDay(day, selectedDate);
                      const isToday = isSameDay(day, new Date());
                      const inMonth = isSameMonth(day, anchorDate);

                      return (
                        <button
                          key={day.toISOString()}
                          onClick={() => setSelectedDate(day)}
                          onDoubleClick={() => openNewDialog(day)}
                          className={cn(
                            "min-h-[96px] rounded-xl p-1.5 text-left border transition-all flex flex-col justify-between cursor-pointer",
                            inMonth
                              ? "bg-muted/30 border-glass-border/60"
                              : "bg-transparent border-transparent opacity-40",
                            isSelected &&
                            "border-primary bg-primary/15 shadow-sm shadow-primary/20",
                            !isSelected && "hover:border-primary/40",
                          )}
                        >
                          <div className="flex items-center justify-between w-full">
                            <span
                              className={cn(
                                "text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full",
                                isToday && "bg-primary text-white",
                              )}
                            >
                              {format(day, "d")}
                            </span>
                            {dayEvents.length > 0 && (
                              <span className="text-[10px] text-muted-foreground px-1">
                                {dayEvents.length}
                              </span>
                            )}
                          </div>
                          <div className="space-y-0.5 w-full mt-1">
                            {dayEvents.slice(0, 3).map((ev) => (
                              <div
                                key={ev.occurrenceId || ev.id}
                                className="truncate rounded px-1 py-0.5 text-[10px] font-medium text-white"
                                style={{
                                  backgroundColor: `${ev.color || getEventTypeColor(ev.eventType)}99`,
                                }}
                              >
                                {ev.allDay
                                  ? ev.title
                                  : `${format(new Date(ev.startAt), "HH:mm")} ${ev.title}`}
                              </div>
                            ))}
                            {dayEvents.length > 3 && (
                              <span className="text-[10px] text-accent block px-1">
                                +{dayEvents.length - 3} more
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Selected Day Agenda */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>{format(selectedDate, "EEEE")}</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  {format(selectedDate, "d MMMM yyyy")} •{" "}
                  {selectedDayEvents.length} event(s)
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => openNewDialog(selectedDate)}
              >
                <Plus className="h-3.5 w-3.5" /> Add
              </Button>
            </CardHeader>
            <CardContent className="space-y-3 max-h-[520px] overflow-y-auto">
              {selectedDayEvents.length === 0 ? (
                <div className="rounded-xl border border-dashed border-glass-border p-8 text-center space-y-3">
                  <CalendarIcon className="h-8 w-8 text-muted-foreground mx-auto" />
                  <p className="text-sm text-muted-foreground">
                    No events scheduled for this day.
                  </p>
                </div>
              ) : (
                selectedDayEvents.map((ev) => (
                  <div
                    key={ev.occurrenceId || ev.id}
                    className="rounded-xl border border-glass-border bg-muted/40 p-3.5 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5">
                          <Badge
                            style={{
                              backgroundColor: `${ev.color || getEventTypeColor(ev.eventType)}25`,
                              color:
                                ev.color || getEventTypeColor(ev.eventType),
                              borderColor: `${ev.color || getEventTypeColor(ev.eventType)}50`,
                            }}
                          >
                            {ev.eventType}
                          </Badge>
                          {ev.isRecurring && (
                            <Badge variant="outline" className="gap-1 text-[10px]">
                              <Repeat className="h-2.5 w-2.5" /> Recurring
                            </Badge>
                          )}
                        </div>
                        <h4 className="font-semibold text-foreground text-sm">
                          {ev.title}
                        </h4>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => openEditSeries(ev.id)}
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                        {ev.isRecurring && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-warning hover:text-warning"
                            onClick={() => skipOccurrence(ev.id, ev.startAt)}
                            title="Skip this day only"
                          >
                            <Ban className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => handleDelete(ev.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      {ev.allDay
                        ? "All Day"
                        : `${format(new Date(ev.startAt), "hh:mm a")} – ${format(new Date(ev.endAt), "hh:mm a")}`}
                    </div>
                    {ev.location && (
                      <div className="flex items-center gap-1.5 text-xs text-accent">
                        <MapPin className="h-3.5 w-3.5" />
                        {ev.location}
                      </div>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* DAY VIEW — Proportional Timeline Studio + Focus Inspector */}
      {viewMode === "DAY" && (() => {
        const timedDayEvents = [...selectedDayEvents]
          .filter((e) => !e.allDay)
          .sort(
            (a, b) =>
              new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
          );
        const allDayEvents = selectedDayEvents.filter((e) => e.allDay);
        const lectureCount = selectedDayEvents.filter(
          (e) => e.eventType === "LECTURE",
        ).length;
        const labCount = selectedDayEvents.filter(
          (e) => e.eventType === "LAB",
        ).length;
        const examCount = selectedDayEvents.filter(
          (e) => e.eventType === "EXAM",
        ).length;

        const nowMinutes = nowDate
          ? (nowDate.getHours() - dayGridBounds.startHour) * 60 +
            nowDate.getMinutes()
          : -1;
        const showNowLine =
          Boolean(nowDate) &&
          isSelectedToday &&
          nowMinutes >= 0 &&
          nowMinutes <=
            (dayGridBounds.endHour - dayGridBounds.startHour) * 60;
        const nowLineTopPx = (nowMinutes / 60) * HOUR_ROW_HEIGHT;

        return (
          <div className="studio-shell grid grid-cols-1 lg:grid-cols-12">
            {/* Left 8-col: Interactive Proportional Hourly Timeline */}
            <div className="lg:col-span-8 flex flex-col border-b lg:border-b-0 lg:border-r border-glass-border/60">
              {/* Timeline Sub-Header */}
              <div className="px-5 py-3.5 border-b border-glass-border/60 bg-muted/20 flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2.5">
                  <span
                    className={cn(
                      "h-8 w-8 rounded-xl flex items-center justify-center text-sm font-bold",
                      isSelectedToday
                        ? "bg-primary text-white shadow-md shadow-primary/30"
                        : "bg-muted text-foreground",
                    )}
                  >
                    {format(selectedDate, "d")}
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground leading-tight">
                      {format(selectedDate, "EEEE, MMMM yyyy")}
                    </h3>
                    <p className="text-[11px] text-muted-foreground">
                      {selectedDayEvents.length === 0
                        ? "Free day"
                        : `${selectedDayEvents.length} scheduled item${selectedDayEvents.length === 1 ? "" : "s"} • ${tzLabel}`}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  {lectureCount > 0 && (
                    <Badge variant="outline" className="text-[10px]">
                      {lectureCount} Lecture{lectureCount === 1 ? "" : "s"}
                    </Badge>
                  )}
                  {labCount > 0 && (
                    <Badge variant="warning" className="text-[10px]">
                      {labCount} Lab{labCount === 1 ? "" : "s"}
                    </Badge>
                  )}
                  {examCount > 0 && (
                    <Badge variant="destructive" className="text-[10px]">
                      {examCount} Exam{examCount === 1 ? "" : "s"}
                    </Badge>
                  )}
                </div>
              </div>

              {/* All-Day Strip */}
              {allDayEvents.length > 0 && (
                <div className="px-5 py-2.5 border-b border-glass-border/50 bg-primary/5 flex flex-wrap gap-2">
                  {allDayEvents.map((ev) => {
                    const pal = getEventPalette(ev);
                    return (
                      <button
                        key={ev.occurrenceId || ev.id}
                        type="button"
                        onClick={() => openEditSeries(ev.id)}
                        className="rounded-lg border px-2.5 py-1 text-xs font-medium cursor-pointer"
                        style={{
                          backgroundColor: pal.bg,
                          borderColor: `${pal.border}55`,
                          color: pal.text,
                        }}
                      >
                        All Day: {ev.title}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Hourly Ruler + Positioned Blocks */}
              {selectedDayEvents.length === 0 ? (
                <div className="flex-1 min-h-[380px] p-10 flex flex-col items-center justify-center text-center space-y-3">
                  <div className="h-12 w-12 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center">
                    <CalendarIcon className="h-6 w-6 text-primary" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-base font-semibold text-foreground">
                      Clear Schedule
                    </h4>
                    <p className="text-xs text-muted-foreground max-w-sm">
                      No lectures, labs, or exams on {format(selectedDate, "EEEE")}. Use &ldquo;Add Event / Lecture&rdquo; above to schedule one.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="p-4 sm:p-5 overflow-x-auto">
                  <div
                    className="grid relative min-w-[440px] select-none"
                    style={{
                      gridTemplateColumns: "64px minmax(0, 1fr)",
                      height: `${(dayGridBounds.endHour - dayGridBounds.startHour) * HOUR_ROW_HEIGHT}px`,
                    }}
                  >
                    {/* Hour Labels */}
                    <div className="relative border-r border-glass-border/50">
                      {dayGridBounds.hours.slice(0, -1).map((hour, idx) => (
                        <div
                          key={hour}
                          className="absolute left-0 right-0 pr-3 text-right text-[11px] font-mono text-muted-foreground/80"
                          style={{ top: `${idx * HOUR_ROW_HEIGHT + 4}px` }}
                        >
                          {hour === 12
                            ? "12 PM"
                            : hour > 12
                              ? `${hour - 12} PM`
                              : `${hour} AM`}
                        </div>
                      ))}
                    </div>

                    {/* Event Track */}
                    <div className="relative">
                      {dayGridBounds.hours.slice(0, -1).map((hour, idx) => (
                        <div
                          key={hour}
                          className="absolute left-0 right-0 border-t border-glass-border/35 pointer-events-none"
                          style={{
                            top: `${idx * HOUR_ROW_HEIGHT}px`,
                            height: `${HOUR_ROW_HEIGHT}px`,
                          }}
                        >
                          <div className="w-full border-t border-dashed border-glass-border/15 mt-[41px]" />
                        </div>
                      ))}

                      {/* Live Current Time Indicator */}
                      {showNowLine && nowDate && (
                        <div
                          className="absolute left-0 right-0 z-30 flex items-center pointer-events-none"
                          style={{ top: `${nowLineTopPx}px` }}
                        >
                          <span className="h-2.5 w-2.5 -ml-1.5 rounded-full bg-primary shadow-[0_0_12px_rgba(124,58,237,0.9)]" />
                          <div className="flex-1 h-[2px] bg-gradient-to-r from-primary via-accent to-transparent" />
                          <span className="rounded-md bg-primary px-1.5 py-0.5 text-[9px] font-mono font-bold text-white shadow">
                            {format(nowDate, "HH:mm")}
                          </span>
                        </div>
                      )}

                      {/* Timed Event Cards */}
                      {timedDayEvents.map((ev) => {
                        const s = new Date(ev.startAt);
                        const e = new Date(ev.endAt);
                        const startMin =
                          (s.getHours() - dayGridBounds.startHour) * 60 +
                          s.getMinutes();
                        const endMin =
                          (e.getHours() - dayGridBounds.startHour) * 60 +
                          e.getMinutes();
                        const durationMin = Math.max(30, endMin - startMin);
                        const topPx = Math.max(
                          2,
                          (startMin / 60) * HOUR_ROW_HEIGHT + 2,
                        );
                        const heightPx = Math.max(
                          46,
                          (durationMin / 60) * HOUR_ROW_HEIGHT - 4,
                        );
                        const pal = getEventPalette(ev);

                        return (
                          <div
                            key={ev.occurrenceId || ev.id}
                            onClick={() => openEditSeries(ev.id)}
                            className="absolute left-3 right-2 rounded-2xl border px-4 py-2.5 group cursor-pointer transition-all hover:z-20 hover:shadow-xl hover:brightness-110 flex items-center justify-between gap-3"
                            style={{
                              top: `${topPx}px`,
                              height: `${heightPx}px`,
                              backgroundColor: pal.bg,
                              borderColor: `${pal.border}55`,
                              borderLeftWidth: "4px",
                              borderLeftColor: pal.border,
                            }}
                          >
                            <div className="min-w-0 flex-1 space-y-0.5">
                              <div className="flex items-center gap-2 min-w-0 flex-wrap">
                                <span
                                  className="text-sm font-semibold truncate"
                                  style={{ color: pal.text }}
                                >
                                  {ev.title}
                                </span>
                                <Badge variant="outline" className="text-[10px] shrink-0">
                                  {ev.eventType}
                                </Badge>
                                {ev.isRecurring && (
                                  <Badge className="gap-1 text-[10px] shrink-0">
                                    <Repeat className="h-2.5 w-2.5" /> Weekly
                                  </Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-3 text-xs text-foreground/75 flex-wrap">
                                <span className="inline-flex items-center gap-1 font-mono text-[11px]">
                                  <Clock className="h-3 w-3" />
                                  {formatCompactTimeRange(ev.startAt, ev.endAt)}
                                </span>
                                <span className="text-[10px] text-foreground/60">
                                  ({durationMin}m)
                                </span>
                                {ev.location && (
                                  <span className="inline-flex items-center gap-1 text-[11px] text-accent">
                                    <MapPin className="h-3 w-3" />
                                    {ev.location}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div
                              className="flex items-center gap-1 shrink-0 opacity-80 group-hover:opacity-100 bg-background/60 backdrop-blur-sm rounded-lg p-1"
                              onClick={(evt) => evt.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={() => openEditSeries(ev.id)}
                                className="p-1.5 rounded-md hover:bg-glass-hover text-foreground/85 cursor-pointer"
                                title="Edit series"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>
                              {ev.isRecurring && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    skipOccurrence(ev.id, ev.startAt)
                                  }
                                  className="p-1.5 rounded-md hover:bg-glass-hover text-amber-400 cursor-pointer"
                                  title="Skip this day only"
                                >
                                  <Ban className="h-3.5 w-3.5" />
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleDelete(ev.id)}
                                className="p-1.5 rounded-md hover:bg-glass-hover text-destructive cursor-pointer"
                                title="Delete series"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Right 4-col: Selected Day Spotlight & Chronological Feed */}
            <div className="lg:col-span-4 bg-muted/15 p-5 flex flex-col gap-4">
              {nextOrCurrentTodayEvent ? (
                <div className="rounded-2xl border border-primary/40 bg-gradient-to-br from-primary/15 via-secondary/10 to-transparent p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-accent">
                      <Zap className="h-3.5 w-3.5 text-primary" />
                      {isSelectedToday &&
                      nowDate &&
                      new Date(nextOrCurrentTodayEvent.startAt) <= nowDate &&
                      new Date(nextOrCurrentTodayEvent.endAt) > nowDate
                        ? "Happening Now"
                        : "Session Spotlight"}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {nextOrCurrentTodayEvent.eventType}
                    </Badge>
                  </div>
                  <p className="text-base font-bold text-foreground">
                    {nextOrCurrentTodayEvent.title}
                  </p>
                  <p className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-primary" />
                      {formatCompactTimeRange(
                        nextOrCurrentTodayEvent.startAt,
                        nextOrCurrentTodayEvent.endAt,
                      )}
                    </span>
                    {nextOrCurrentTodayEvent.location && (
                      <span className="inline-flex items-center gap-1 text-accent">
                        <MapPin className="h-3.5 w-3.5" />
                        {nextOrCurrentTodayEvent.location}
                      </span>
                    )}
                  </p>
                </div>
              ) : (
                <div className="rounded-2xl border border-glass-border/60 bg-muted/25 p-4 text-xs text-muted-foreground">
                  Open schedule — use this time for deep syllabus study or flashcards.
                </div>
              )}

              <div className="space-y-2 flex-1">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Day Rundown ({timedDayEvents.length})
                </h4>
                {timedDayEvents.length === 0 ? (
                  <p className="text-xs text-muted-foreground/80">
                    No timed sessions on this date.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                    {timedDayEvents.map((ev) => {
                      const pal = getEventPalette(ev);
                      return (
                        <div
                          key={`side-${ev.occurrenceId || ev.id}`}
                          onClick={() => openEditSeries(ev.id)}
                          className="rounded-xl border border-glass-border/70 bg-muted/35 p-3 hover:border-primary/40 transition-colors cursor-pointer flex items-center justify-between gap-2"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span
                              className="h-2.5 w-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: pal.border }}
                            />
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-foreground truncate">
                                {ev.title}
                              </p>
                              <p className="text-[11px] text-muted-foreground truncate">
                                {formatCompactTimeRange(ev.startAt, ev.endAt)}
                                {ev.location ? ` • ${ev.location}` : ""}
                              </p>
                            </div>
                          </div>
                          <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                            {ev.eventType}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Add / Edit Dialog with Recurrence */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Edit Event / Lecture Series" : "New Calendar Event"}
            </DialogTitle>
            <DialogDescription>
              Add a one-time exam/holiday or a weekly recurring lecture
              timetable slot.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ev-title">Title</Label>
              <Input
                id="ev-title"
                placeholder="e.g., EEGD Lecture"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Event Type</Label>
                <Select
                  value={eventType}
                  onValueChange={(v) =>
                    setEventType(v as CalendarEvent["eventType"])
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LECTURE">Lecture</SelectItem>
                    <SelectItem value="LAB">Lab</SelectItem>
                    <SelectItem value="EXAM">Exam</SelectItem>
                    <SelectItem value="HOLIDAY">Holiday</SelectItem>
                    <SelectItem value="CUSTOM">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ev-date">Start Date (DD/MM/YYYY)</Label>
                <DateInputDDMMYYYY
                  id="ev-date"
                  value={dateStr}
                  onChange={setDateStr}
                  required
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                id="ev-allday"
                type="checkbox"
                checked={allDay}
                onChange={(e) => setAllDay(e.target.checked)}
                className="rounded border-glass-border accent-primary"
              />
              <Label htmlFor="ev-allday" className="cursor-pointer">
                All-day event (e.g., college holiday)
              </Label>
            </div>

            {!allDay && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="ev-start">Start Time</Label>
                  <Input
                    id="ev-start"
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ev-end">End Time</Label>
                  <Input
                    id="ev-end"
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                  />
                </div>
              </div>
            )}

            {/* Recurrence Controls */}
            <div className="rounded-xl border border-glass-border bg-muted/40 p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1.5 text-sm">
                  <Repeat className="h-4 w-4 text-primary" />
                  Repeat Schedule
                </Label>
                <Select
                  value={freq}
                  onValueChange={(v) =>
                    setFreq(v as "NONE" | "DAILY" | "WEEKLY")
                  }
                >
                  <SelectTrigger className="w-[160px] h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">Does not repeat</SelectItem>
                    <SelectItem value="WEEKLY">Every Week</SelectItem>
                    <SelectItem value="DAILY">Every Day</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {freq === "WEEKLY" && (
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">
                    Repeat on days
                  </Label>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {WEEKDAYS.map((w) => (
                      <button
                        key={w.day}
                        type="button"
                        onClick={() => toggleWeekday(w.day)}
                        className={cn(
                          "px-2.5 py-1 rounded-md text-xs font-medium border transition-colors cursor-pointer",
                          daysOfWeek.includes(w.day)
                            ? "bg-primary text-white border-primary"
                            : "border-glass-border text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {w.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {freq !== "NONE" && (
                <div className="space-y-1.5">
                  <Label htmlFor="ev-until" className="text-xs text-muted-foreground">
                    Repeat until (optional, DD/MM/YYYY)
                  </Label>
                  <DateInputDDMMYYYY
                    id="ev-until"
                    value={repeatUntil}
                    onChange={setRepeatUntil}
                  />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="ev-location">Location / Room (Optional)</Label>
              <Input
                id="ev-location"
                placeholder="e.g., Block A - Room 304"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ev-desc">Notes (Optional)</Label>
              <Textarea
                id="ev-desc"
                placeholder="Faculty, lab batch, syllabus notes..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
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
                  : editingId
                    ? "Save Series"
                    : "Create Event"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* AI Timetable Import & Interactive Review Studio */}
      <Dialog open={ttOpen} onOpenChange={setTtOpen}>
        <DialogContent
          className={cn(
            "max-h-[92vh] overflow-y-auto space-y-5",
            ttRows.length > 0 ? "max-w-4xl" : "max-w-3xl",
          )}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Smart Timetable Importer
            </DialogTitle>
            <DialogDescription>
              Upload your timetable screenshot or PDF, review the extracted weekly
              lectures &amp; labs, and uncheck anything that doesn&apos;t apply to you.
            </DialogDescription>
          </DialogHeader>

          {rawEvents.length > 0 && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border border-glass-border bg-muted/40 px-3.5 py-2.5 text-xs">
              <span className="text-muted-foreground">
                You currently have{" "}
                <span className="text-foreground font-semibold">
                  {rawEvents.length}
                </span>{" "}
                calendar series ({recurringRawEvents.length} recurring). Need a
                fresh import?
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs border-destructive/30 text-destructive hover:bg-destructive/10 shrink-0"
                onClick={() => openClearDialog()}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Reset Calendar
              </Button>
            </div>
          )}

          <form onSubmit={handleParseTimetable} className="space-y-5">
            {/* 1. Upload & Visual Preview (Stacked Vertical Layout) */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium">
                  1. Timetable Image or PDF
                </Label>
                {ttFile && (
                  <button
                    type="button"
                    onClick={() => {
                      selectTimetableFile(null);
                      if (ttFileRef.current) ttFileRef.current.value = "";
                    }}
                    className="text-xs text-destructive hover:underline cursor-pointer"
                  >
                    Remove file
                  </button>
                )}
              </div>

              {!ttFile ? (
                <div
                  onClick={() => ttFileRef.current?.click()}
                  className="rounded-xl border border-dashed border-glass-border bg-muted/35 p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-glass-hover transition-colors"
                >
                  <Upload className="h-7 w-7 text-primary mx-auto mb-2" />
                  <p className="text-sm font-medium text-foreground">
                    Click to upload PNG, JPG, WEBP, PDF, DOCX, or CSV
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Tip: Uploading the original timetable PDF/CSV (or cropping to just the Mon–Sat grid) parses in seconds cleanly
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-glass-border bg-muted/40 overflow-hidden">
                  <div className="flex items-center justify-between px-3.5 py-2 border-b border-glass-border/60 bg-background/40">
                    <span className="text-xs font-medium text-foreground truncate">
                      {ttFile.name} ({Math.round(ttFile.size / 1024)} KB)
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => ttFileRef.current?.click()}
                    >
                      Replace File
                    </Button>
                  </div>
                  {ttPreviewUrl && ttFile.type.startsWith("image/") ? (
                    <div className="p-3 bg-black/30 flex justify-center">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={ttPreviewUrl}
                        alt="Uploaded timetable preview"
                        className="max-h-72 w-auto rounded-lg object-contain border border-glass-border/50"
                      />
                    </div>
                  ) : ttPreviewUrl && ttFile.type === "application/pdf" ? (
                    <iframe
                      src={ttPreviewUrl}
                      title="PDF timetable preview"
                      className="w-full h-64 bg-white"
                    />
                  ) : (
                    <div className="p-4 text-xs text-muted-foreground">
                      Document ready for text extraction: {ttFile.name}
                    </div>
                  )}
                </div>
              )}

              <input
                ref={ttFileRef}
                type="file"
                accept="image/*,.pdf,.docx,.txt,.csv"
                onChange={(e) => selectTimetableFile(e.target.files?.[0] || null)}
                className="hidden"
              />
            </div>

            {/* 2. Extra Context / Paste Text */}
            <div className="space-y-2">
              <Label htmlFor="tt-extra-context" className="text-xs font-medium">
                2. Extra Instructions or Schedule Text (Optional)
              </Label>
              <Textarea
                id="tt-extra-context"
                rows={3}
                placeholder="Example: I am in Section A4, skip Re- remedial slots, Office hours, and Library. Or paste plain text schedule..."
                value={ttRawText}
                onChange={(e) => setTtRawText(e.target.value)}
              />
            </div>

            {/* 3. Repeat Until (DD/MM/YYYY) + Fast Mode + Extract Button */}
            <div className="rounded-xl border border-glass-border/80 bg-muted/30 p-4 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div className="space-y-2 flex-1">
                  <Label htmlFor="tt-until" className="text-xs font-medium">
                    3. Repeat Weekly Until (Optional, DD/MM/YYYY)
                  </Label>
                  <DateInputDDMMYYYY
                    id="tt-until"
                    value={ttRepeatUntil}
                    onChange={setTtRepeatUntil}
                    placeholder="DD/MM/YYYY"
                  />
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    type="submit"
                    variant="glow"
                    disabled={ttParsing}
                    className="h-10"
                  >
                    {ttParsing ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Scanning ({ttElapsed}s)...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" />
                        Extract &amp; Preview Classes
                      </>
                    )}
                  </Button>
                  {ttParsing && (
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      className="h-10"
                      onClick={stopTimetableParse}
                    >
                      <Square className="h-3.5 w-3.5" /> Stop
                    </Button>
                  )}
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer pt-1 border-t border-glass-border/50">
                <input
                  type="checkbox"
                  checked={ttFastMode}
                  onChange={(e) => setTtFastMode(e.target.checked)}
                  className="rounded accent-primary cursor-pointer"
                />
                <span>
                  Fast Mode (skip extended thinking tokens — recommended for dense timetables on 8GB local Ollama)
                </span>
              </label>
            </div>
          </form>

          {/* Live AI Thinking Console (only shown when Debug Mode is enabled in Settings, or on error) */}
          {(ttDebugMeta?.debugMode || ttStreamError) && (
            <div className="pt-1">
              <AiDebugPanel
                active={Boolean(ttDebugMeta?.debugMode || ttStreamError)}
                loading={ttParsing}
                elapsedSeconds={ttElapsed}
                thinkingText={ttStreamThinking}
                outputText={ttStreamOutput}
                errorText={ttStreamError}
                model={ttDebugMeta?.model}
                extraLabel={ttDebugMeta?.mode}
              />
            </div>
          )}

          {ttRows.length > 0 && (
            <div className="space-y-3 pt-4 border-t border-glass-border">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CheckSquare className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold">
                    Review Extracted Slots ({ttRows.filter((r) => r.include).length}{" "}
                    / {ttRows.length} selected)
                  </span>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setTtRows((prev) =>
                        prev.map((r) => ({ ...r, include: r.recommended })),
                      )
                    }
                  >
                    Recommended Only
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setTtRows((prev) =>
                        prev.map((r) => ({ ...r, include: true })),
                      )
                    }
                  >
                    Select All
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setTtRows((prev) =>
                        prev.map((r) => ({ ...r, include: false })),
                      )
                    }
                  >
                    Clear All
                  </Button>
                </div>
              </div>

              <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
                {ttRows.map((row, idx) => (
                  <div
                    key={`${row.dayOfWeek}-${row.startTime}-${idx}`}
                    className={cn(
                      "rounded-xl border p-3 space-y-2.5 transition-colors",
                      row.include
                        ? "border-primary/40 bg-primary/5"
                        : "border-glass-border/50 bg-muted/25 opacity-60",
                    )}
                  >
                    {/* Top Row: Checkbox + Day Picker + Start/End Time + Tag + Remove */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="checkbox"
                          checked={row.include}
                          onChange={(e) =>
                            setTtRows((prev) =>
                              prev.map((r, i) =>
                                i === idx
                                  ? { ...r, include: e.target.checked }
                                  : r,
                              ),
                            )
                          }
                          className="h-4 w-4 rounded accent-primary cursor-pointer shrink-0"
                        />

                        <Select
                          value={String(row.dayOfWeek)}
                          onValueChange={(v) =>
                            setTtRows((prev) =>
                              prev.map((r, i) =>
                                i === idx ? { ...r, dayOfWeek: Number(v) } : r,
                              ),
                            )
                          }
                        >
                          <SelectTrigger className="h-8 w-[84px] text-xs font-semibold text-accent">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(DOW_LABELS).map(([k, label]) => (
                              <SelectItem key={k} value={k}>
                                {label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <div className="flex items-center gap-1.5">
                          <Input
                            type="time"
                            value={row.startTime}
                            onChange={(e) =>
                              setTtRows((prev) =>
                                prev.map((r, i) =>
                                  i === idx
                                    ? { ...r, startTime: e.target.value }
                                    : r,
                                ),
                              )
                            }
                            className="h-8 w-[124px] text-xs px-2.5"
                          />
                          <span className="text-xs text-muted-foreground">
                            to
                          </span>
                          <Input
                            type="time"
                            value={row.endTime}
                            onChange={(e) =>
                              setTtRows((prev) =>
                                prev.map((r, i) =>
                                  i === idx
                                    ? { ...r, endTime: e.target.value }
                                    : r,
                                ),
                              )
                            }
                            className="h-8 w-[124px] text-xs px-2.5"
                          />
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Select
                          value={row.eventType}
                          onValueChange={(v) =>
                            setTtRows((prev) =>
                              prev.map((r, i) =>
                                i === idx
                                  ? {
                                    ...r,
                                    eventType:
                                      v as ParsedTimetableRow["eventType"],
                                  }
                                  : r,
                              ),
                            )
                          }
                        >
                          <SelectTrigger className="h-8 w-[100px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="LECTURE">Lecture</SelectItem>
                            <SelectItem value="LAB">Lab</SelectItem>
                            <SelectItem value="CUSTOM">Custom</SelectItem>
                          </SelectContent>
                        </Select>

                        <Badge
                          variant={row.recommended ? "outline" : "warning"}
                          className="text-[10px] shrink-0"
                        >
                          {row.tag}
                        </Badge>
                      </div>
                    </div>

                    {/* Bottom Row: Clean Full Course Title + Optional Room */}
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pl-6">
                      <Input
                        value={row.title}
                        onChange={(e) =>
                          setTtRows((prev) =>
                            prev.map((r, i) =>
                              i === idx ? { ...r, title: e.target.value } : r,
                            ),
                          )
                        }
                        className="h-8 text-xs flex-1 font-medium"
                        placeholder="Course title (e.g., CHEM)"
                      />
                      <Input
                        value={row.location}
                        onChange={(e) =>
                          setTtRows((prev) =>
                            prev.map((r, i) =>
                              i === idx
                                ? { ...r, location: e.target.value }
                                : r,
                            ),
                          )
                        }
                        className="h-8 text-xs sm:w-40"
                        placeholder="Room (optional)"
                      />
                    </div>
                  </div>
                ))}
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setTtOpen(false)}
                >
                  Close
                </Button>
                <Button
                  type="button"
                  variant="glow"
                  onClick={handleImportSelectedTimetable}
                  disabled={
                    ttImporting || ttRows.filter((r) => r.include).length === 0
                  }
                >
                  {ttImporting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Importing...
                    </>
                  ) : (
                    `Import ${ttRows.filter((r) => r.include).length} Selected Weekly Classes`
                  )}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Reset / Mass Delete Calendar Dialog */}
      <Dialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto space-y-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Reset / Mass Delete Calendar
            </DialogTitle>
            <DialogDescription>
              Remove imported timetable classes or reset your calendar in one
              click. This permanently deletes the selected event series.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2.5">
            {recurringRawEvents.length > 0 && (
              <button
                type="button"
                onClick={() => setClearScope("recurring")}
                className={cn(
                  "w-full text-left rounded-xl border p-3.5 transition-all cursor-pointer",
                  clearScope === "recurring"
                    ? "border-destructive/60 bg-destructive/10"
                    : "border-glass-border bg-muted/30 hover:border-glass-border/80",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground">
                    Delete recurring timetable classes only
                  </span>
                  <Badge variant="outline">
                    {recurringRawEvents.length} series
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Clears weekly/daily imported classes while keeping one-time
                  exams, holidays, and custom events.
                </p>
              </button>
            )}

            <button
              type="button"
              onClick={() => setClearScope("all")}
              className={cn(
                "w-full text-left rounded-xl border p-3.5 transition-all cursor-pointer",
                clearScope === "all"
                  ? "border-destructive/60 bg-destructive/10"
                  : "border-glass-border bg-muted/30 hover:border-glass-border/80",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-foreground">
                  Reset entire calendar
                </span>
                <Badge variant="outline">{rawEvents.length} series</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Deletes every event and recurring series on your calendar.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setClearScope("selected")}
              className={cn(
                "w-full text-left rounded-xl border p-3.5 transition-all cursor-pointer",
                clearScope === "selected"
                  ? "border-destructive/60 bg-destructive/10"
                  : "border-glass-border bg-muted/30 hover:border-glass-border/80",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-foreground">
                  Select specific series to delete
                </span>
                <Badge variant="outline">
                  {selectedClearIds.length} / {rawEvents.length} selected
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Pick individual classes or events to bulk remove.
              </p>
            </button>
          </div>

          {clearScope === "selected" && (
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {selectedClearIds.length} selected
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedClearIds(rawEvents.map((r) => r.id))
                    }
                    className="text-accent hover:underline cursor-pointer"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedClearIds([])}
                    className="text-muted-foreground hover:underline cursor-pointer"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
                {rawEvents.map((raw) => {
                  const checked = selectedClearIds.includes(raw.id);
                  return (
                    <label
                      key={raw.id}
                      className={cn(
                        "flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs cursor-pointer transition-colors",
                        checked
                          ? "border-destructive/50 bg-destructive/10"
                          : "border-glass-border/60 bg-muted/25",
                      )}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedClearIds((prev) => [...prev, raw.id]);
                            } else {
                              setSelectedClearIds((prev) =>
                                prev.filter((id) => id !== raw.id),
                              );
                            }
                          }}
                          className="rounded accent-destructive cursor-pointer shrink-0"
                        />
                        <span className="font-medium text-foreground truncate">
                          {raw.title}
                        </span>
                      </span>
                      <span className="text-[11px] text-muted-foreground shrink-0">
                        {format(new Date(raw.startAt), "EEE HH:mm")} •{" "}
                        {raw.eventType}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setClearDialogOpen(false)}
              disabled={clearing}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleClearCalendar}
              disabled={
                clearing ||
                (clearScope === "recurring" &&
                  recurringRawEvents.length === 0) ||
                (clearScope === "selected" && selectedClearIds.length === 0) ||
                rawEvents.length === 0
              }
            >
              {clearing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                `Delete ${clearScope === "recurring"
                  ? recurringRawEvents.length
                  : clearScope === "selected"
                    ? selectedClearIds.length
                    : rawEvents.length
                } Series`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
