"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Play,
  Pause,
  RotateCcw,
  Check,
  Flame,
  Clock,
  Coffee,
  Volume2,
  VolumeX,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn, formatDateTime, formatDuration } from "@/lib/utils";

type Mode = "FOCUS" | "SHORT_BREAK" | "LONG_BREAK";

interface SubjectOption {
  id: string;
  name: string;
  code: string | null;
  color: string;
}

interface PomodoroSessionItem {
  id: string;
  duration: number;
  sessionType: string;
  completedAt: string;
  subject: SubjectOption | null;
}

interface PomodoroStats {
  todayMinutes: number;
  todayCount: number;
  weekMinutes: number;
  totalMinutes: number;
  totalCount: number;
}

const DEFAULT_DURATIONS: Record<Mode, number> = {
  FOCUS: 25 * 60,
  SHORT_BREAK: 5 * 60,
  LONG_BREAK: 15 * 60,
};

function playChime() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    [523.25, 659.25, 783.99].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + idx * 0.14);
      gain.gain.setValueAtTime(0.001, now + idx * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.18, now + idx * 0.14 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.14 + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.14);
      osc.stop(now + idx * 0.14 + 0.55);
    });
  } catch {
    // Ignore
  }
}

export function PomodoroWidget() {
  const [durations, setDurations] = useState<Record<Mode, number>>(DEFAULT_DURATIONS);
  const [mode, setMode] = useState<Mode>("FOCUS");
  const [secondsLeft, setSecondsLeft] = useState(DEFAULT_DURATIONS.FOCUS);
  const [running, setRunning] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [selectedSubjectId, setSelectedSubjectId] = useState("NONE");

  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [sessions, setSessions] = useState<PomodoroSessionItem[]>([]);
  const [stats, setStats] = useState<PomodoroStats>({
    todayMinutes: 0,
    todayCount: 0,
    weekMinutes: 0,
    totalMinutes: 0,
    totalCount: 0,
  });

  const completedRef = useRef(false);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        const saved = localStorage.getItem("studysync_pomodoro_prefs");
        if (saved) {
          const parsed = JSON.parse(saved);
          const next: Record<Mode, number> = {
            FOCUS: (parsed.focusMinutes || 25) * 60,
            SHORT_BREAK: (parsed.shortBreakMinutes || 5) * 60,
            LONG_BREAK: (parsed.longBreakMinutes || 15) * 60,
          };
          setDurations(next);
          setSecondsLeft(next.FOCUS);
        }
      } catch {
        // Ignore
      }
    });

    Promise.all([fetch("/api/pomodoro"), fetch("/api/subjects")])
      .then(async ([pRes, sRes]) => {
        if (!active) return;
        if (pRes.ok) {
          const pJson = await pRes.json();
          if (active) {
            setSessions(pJson.sessions || []);
            if (pJson.stats) setStats(pJson.stats);
          }
        }
        if (sRes.ok) {
          const sJson = await sRes.json();
          if (active) setSubjects(sJson.subjects || []);
        }
      })
      .catch(() => {
        if (active) toast.error("Failed to load Pomodoro history");
      });

    return () => {
      active = false;
    };
  }, []);

  const loadData = useCallback(async () => {
    try {
      const [pRes, sRes] = await Promise.all([
        fetch("/api/pomodoro"),
        fetch("/api/subjects"),
      ]);
      if (pRes.ok) {
        const pJson = await pRes.json();
        setSessions(pJson.sessions || []);
        if (pJson.stats) setStats(pJson.stats);
      }
      if (sRes.ok) {
        const sJson = await sRes.json();
        setSubjects(sJson.subjects || []);
      }
    } catch {
      toast.error("Failed to load Pomodoro history");
    }
  }, []);

  const logSession = useCallback(
    async (sessionMode: Mode, elapsedSeconds: number) => {
      if (elapsedSeconds < 10) return;
      try {
        const res = await fetch("/api/pomodoro", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionType: sessionMode,
            duration: elapsedSeconds,
            breakDuration: durations.SHORT_BREAK,
            subjectId: selectedSubjectId === "NONE" ? null : selectedSubjectId,
          }),
        });
        if (!res.ok) throw new Error();
        loadData();
      } catch {
        toast.error("Could not save session");
      }
    },
    [durations.SHORT_BREAK, loadData, selectedSubjectId],
  );

  useEffect(() => {
    if (!running) return;
    completedRef.current = false;

    const timer = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setRunning(false);
          if (!completedRef.current) {
            completedRef.current = true;
            if (soundEnabled) playChime();
            toast.success(
              mode === "FOCUS"
                ? "Focus session complete! Time for a break."
                : "Break over! Ready for the next focus sprint.",
            );
            logSession(mode, durations[mode]);
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [running, mode, durations, soundEnabled, logSession]);

  function switchMode(nextMode: Mode) {
    setRunning(false);
    setMode(nextMode);
    setSecondsLeft(durations[nextMode]);
  }

  function resetTimer() {
    setRunning(false);
    setSecondsLeft(durations[mode]);
  }

  async function completeEarly() {
    const elapsed = durations[mode] - secondsLeft;
    setRunning(false);
    setSecondsLeft(durations[mode]);
    if (elapsed < 10) {
      toast.info("Study for at least 10 seconds to log a session");
      return;
    }
    await logSession(mode, elapsed);
    toast.success("Session logged!");
  }

  const totalSeconds = durations[mode];
  const progress =
    totalSeconds > 0 ? ((totalSeconds - secondsLeft) / totalSeconds) * 100 : 0;
  const radius = 112;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <Card className="lg:col-span-2 p-6 sm:p-8 flex flex-col items-center justify-center space-y-6 relative overflow-hidden">
        <div className="w-full flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 bg-muted p-1 rounded-xl">
            {(
              [
                { id: "FOCUS", label: "Focus", icon: Flame },
                { id: "SHORT_BREAK", label: "Short Break", icon: Coffee },
                { id: "LONG_BREAK", label: "Long Break", icon: Clock },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                onClick={() => switchMode(m.id)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer",
                  mode === m.id
                    ? "bg-primary text-white shadow-lg shadow-primary/30"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <m.icon className="h-3.5 w-3.5" />
                {m.label}
              </button>
            ))}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setSoundEnabled(!soundEnabled)}
          >
            {soundEnabled ? (
              <>
                <Volume2 className="h-4 w-4 text-primary" /> Sound On
              </>
            ) : (
              <>
                <VolumeX className="h-4 w-4 text-muted-foreground" /> Muted
              </>
            )}
          </Button>
        </div>

        <div className="relative flex items-center justify-center">
          <svg className="w-64 h-64 -rotate-90" viewBox="0 0 260 260">
            <defs>
              <linearGradient
                id="pomoGradient"
                x1="0%"
                y1="0%"
                x2="100%"
                y2="100%"
              >
                <stop offset="0%" stopColor="#7C3AED" />
                <stop offset="50%" stopColor="#A78BFA" />
                <stop offset="100%" stopColor="#6366F1" />
              </linearGradient>
            </defs>
            <circle
              cx="130"
              cy="130"
              r={radius}
              stroke="rgba(124, 58, 237, 0.15)"
              strokeWidth="11"
              fill="none"
            />
            <circle
              cx="130"
              cy="130"
              r={radius}
              stroke="url(#pomoGradient)"
              strokeWidth="11"
              strokeLinecap="round"
              fill="none"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              className="transition-all duration-500 ease-out"
              style={{
                filter: running
                  ? "drop-shadow(0 0 12px rgba(124, 58, 237, 0.7))"
                  : "none",
              }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xs uppercase tracking-widest text-accent font-medium mb-1">
              {mode.replace("_", " ")}
            </span>
            <span className="text-5xl font-bold font-mono tracking-tight text-foreground">
              {formatDuration(secondsLeft)}
            </span>
            <span className="text-xs text-muted-foreground mt-2">
              {running ? "Stay focused" : "Ready"}
            </span>
          </div>
        </div>

        <div className="w-full max-w-sm space-y-4">
          <Select
            value={selectedSubjectId}
            onValueChange={setSelectedSubjectId}
          >
            <SelectTrigger>
              <SelectValue placeholder="Tag a subject (optional)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NONE">General Study</SelectItem>
              {subjects.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.code ? `${s.code} — ${s.name}` : s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-center justify-center gap-3">
            <Button
              variant="outline"
              size="icon"
              onClick={resetTimer}
              title="Reset timer"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button
              variant="glow"
              size="lg"
              className="min-w-[140px]"
              onClick={() => setRunning(!running)}
            >
              {running ? (
                <>
                  <Pause className="h-5 w-5" /> Pause
                </>
              ) : (
                <>
                  <Play className="h-5 w-5" /> Start
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={completeEarly}
              title="Finish & Log Session"
            >
              <Check className="h-4 w-4 text-emerald-400" />
            </Button>
          </div>
        </div>
      </Card>

      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Today</p>
            <p className="text-2xl font-bold mt-1">
              {stats.todayMinutes}{" "}
              <span className="text-xs font-normal">m</span>
            </p>
            <p className="text-xs text-accent mt-1">
              {stats.todayCount} sessions
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">7 Days</p>
            <p className="text-2xl font-bold mt-1">
              {stats.weekMinutes} <span className="text-xs font-normal">m</span>
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {stats.totalCount} total ever
            </p>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Sessions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5 max-h-[340px] overflow-y-auto">
            {sessions.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                Complete your first Pomodoro session to log focus hours.
              </p>
            ) : (
              sessions.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-glass-border/60 bg-muted/40 p-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {s.subject?.name || "General Study"}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {formatDateTime(s.completedAt)}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    {Math.max(1, Math.round(s.duration / 60))}m
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
