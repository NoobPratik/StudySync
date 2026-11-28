"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import {
  Layers,
  FileCheck2,
  Sparkles,
  Plus,
  Trash2,
  RotateCw,
  Upload,
  Loader2,
  Clock,
  Eye,
  EyeOff,
  CheckCircle2,
  Square,
  Copy,
  Check,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { useElapsedSeconds } from "@/hooks/use-elapsed-timer";
import { cn, formatDate, formatDuration } from "@/lib/utils";
import { StudyHeroEmblem, OrbitalIllustration } from "@/components/ui/study-emblem";
import { AiLogsButton } from "@/components/ui/ai-logs-dialog";
import { useBackgroundAi } from "@/components/background-extraction-provider";

interface Subject {
  id: string;
  name: string;
  code: string | null;
  color: string;
  modules?: Array<{ id: string; name: string }>;
}

interface Flashcard {
  id: string;
  front: string;
  back: string;
  topicTag: string | null;
  intervalDays: number;
  repetitions: number;
  nextReviewAt: string;
}

interface FlashcardDeck {
  id: string;
  title: string;
  source: string | null;
  subjectId: string | null;
  subject: Subject | null;
  cards: Flashcard[];
  createdAt: string;
}

interface SamplePaper {
  id: string;
  title: string;
  fileName: string;
  subjectId: string | null;
  subject: Subject | null;
  createdAt: string;
}

interface MockQuestion {
  number: string;
  question: string;
  marks: number;
  type?: string;
  modelAnswer: string;
  markingScheme?: string;
}

interface MockSection {
  title: string;
  instructions?: string;
  questions: MockQuestion[];
}

interface ParsedExamContent {
  title?: string;
  patternNotes?: string;
  sections: MockSection[];
}

interface MockExam {
  id: string;
  title: string;
  durationMinutes: number;
  totalMarks: number;
  examContent: string;
  score: number | null;
  completedAt: string | null;
  subject: Subject | null;
  samplePaper: { id: string; title: string } | null;
  createdAt: string;
}

export default function PracticePage() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [decks, setDecks] = useState<FlashcardDeck[]>([]);
  const [samplePapers, setSamplePapers] = useState<SamplePaper[]>([]);
  const [mockExams, setMockExams] = useState<MockExam[]>([]);
  const [loading, setLoading] = useState(true);

  // Flashcard generation form
  const fcAbortRef = useRef<AbortController | null>(null);
  const [fcSubjectId, setFcSubjectId] = useState("");
  const [fcModuleId, setFcModuleId] = useState("ALL");
  const [fcCount, setFcCount] = useState(10);
  const [generatingDeck, setGeneratingDeck] = useState(false);

  // Active flashcard study modal
  const [studyDeck, setStudyDeck] = useState<FlashcardDeck | null>(null);
  const [studyIdx, setStudyIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);

  // PYQ upload modal
  const pyqFileRef = useRef<HTMLInputElement>(null);
  const [pyqOpen, setPyqOpen] = useState(false);
  const [pyqTitle, setPyqTitle] = useState("");
  const [pyqSubjectId, setPyqSubjectId] = useState("NONE");
  const [pyqFile, setPyqFile] = useState<File | null>(null);
  const [pyqText, setPyqText] = useState("");
  const [savingPyq, setSavingPyq] = useState(false);

  // Mock Exam generator form
  const exAbortRef = useRef<AbortController | null>(null);
  const [exSubjectId, setExSubjectId] = useState("");
  const [exModuleId, setExModuleId] = useState("ALL");
  const [exSampleId, setExSampleId] = useState("NONE");
  const [exMarks, setExMarks] = useState(50);
  const [exDuration, setExDuration] = useState(90);
  const [exInstructions, setExInstructions] = useState("");
  const [generatingExam, setGeneratingExam] = useState(false);

  // Active Mock Exam Runner
  const [activeExam, setActiveExam] = useState<MockExam | null>(null);
  const [revealedAnswers, setRevealedAnswers] = useState<
    Record<string, boolean>
  >({});
  const [examSecondsLeft, setExamSecondsLeft] = useState(0);
  const [examRunning, setExamRunning] = useState(false);
  const [scoreInput, setScoreInput] = useState("");
  const [copiedPaper, setCopiedPaper] = useState(false);

  const aiElapsed = useElapsedSeconds(generatingDeck || generatingExam);

  const loadAll = useCallback(async () => {
    try {
      const [sRes, dRes, pRes, eRes] = await Promise.all([
        fetch("/api/subjects"),
        fetch("/api/flashcards"),
        fetch("/api/sample-papers"),
        fetch("/api/mock-exams"),
      ]);
      if (sRes.ok) {
        const sj = await sRes.json();
        const subs: Subject[] = sj.subjects || [];
        setSubjects(subs);
        if (subs.length > 0) {
          setFcSubjectId((prev) => prev || subs[0].id);
          setExSubjectId((prev) => prev || subs[0].id);
        }
      }
      if (dRes.ok) setDecks((await dRes.json()).decks || []);
      if (pRes.ok) setSamplePapers((await pRes.json()).samplePapers || []);
      if (eRes.ok) setMockExams((await eRes.json()).mockExams || []);
    } catch {
      toast.error("Failed to load practice studio");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/subjects"),
      fetch("/api/flashcards"),
      fetch("/api/sample-papers"),
      fetch("/api/mock-exams"),
    ])
      .then(async ([sRes, dRes, pRes, eRes]) => {
        if (!active) return;
        if (sRes.ok) {
          const subs: Subject[] = (await sRes.json()).subjects || [];
          if (active) {
            setSubjects(subs);
            if (subs.length > 0) {
              setFcSubjectId(subs[0].id);
              setExSubjectId(subs[0].id);
            }
          }
        }
        if (dRes.ok && active) setDecks((await dRes.json()).decks || []);
        if (pRes.ok && active)
          setSamplePapers((await pRes.json()).samplePapers || []);
        if (eRes.ok && active)
          setMockExams((await eRes.json()).mockExams || []);
      })
      .catch(() => {
        if (active) toast.error("Failed to load practice studio");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Countdown timer for active Mock Exam
  useEffect(() => {
    if (!examRunning) return;
    const id = setInterval(() => {
      setExamSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(id);
          setExamRunning(false);
          toast.info("Mock exam time finished!");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [examRunning]);

  const { startAiTask, stopAiTask } = useBackgroundAi();

  useEffect(() => {
    const onAiComplete = (evt: Event) => {
      const detail = (evt as CustomEvent<{ feature?: string }>).detail;
      if (
        detail?.feature === "flashcards_generate" ||
        detail?.feature === "mock_exam_generate"
      ) {
        loadAll();
      }
    };
    window.addEventListener("ai-task-completed", onAiComplete);
    return () => window.removeEventListener("ai-task-completed", onAiComplete);
  }, [loadAll]);

  async function handleGenerateDeck(e: React.FormEvent) {
    e.preventDefault();
    if (!fcSubjectId) {
      toast.error("Create/select a Subject first");
      return;
    }
    const subName =
      subjects.find((s) => s.id === fcSubjectId)?.name || "Subject";
    setGeneratingDeck(true);
    try {
      await startAiTask({
        id: "flashcards-gen",
        feature: "flashcards_generate",
        title: "Flashcard Deck Generator",
        subtitle: `Building ${fcCount} active-recall cards for ${subName}...`,
        actionLabel: "Study Deck",
        actionHref: "/practice",
        run: async (signal) => {
          const res = await fetch("/api/flashcards", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal,
            body: JSON.stringify({
              subjectId: fcSubjectId,
              moduleId: fcModuleId === "ALL" ? null : fcModuleId,
              count: fcCount,
            }),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || "Failed to generate deck");
          return json.deck as FlashcardDeck;
        },
        onComplete: (deck) => {
          toast.success(`Created "${deck.title}" (${deck.cards.length} cards)`);
          loadAll();
        },
        onOpenResult: (deck) => {
          setStudyDeck(deck);
          setStudyIdx(0);
          setFlipped(false);
        },
      });
    } finally {
      setGeneratingDeck(false);
    }
  }

  function stopDeckGeneration() {
    stopAiTask("flashcards-gen");
    fcAbortRef.current?.abort();
  }

  const rateCard = useCallback(
    async (quality: "AGAIN" | "HARD" | "GOOD" | "EASY") => {
      if (!studyDeck) return;
      const current = studyDeck.cards[studyIdx];
      if (!current) return;

      try {
        const res = await fetch(`/api/flashcards/${current.id}/review`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quality }),
        });
        if (!res.ok) throw new Error();
        const { card } = await res.json();

        setStudyDeck((prev) =>
          prev
            ? {
                ...prev,
                cards: prev.cards.map((c) => (c.id === card.id ? card : c)),
              }
            : null,
        );
        setFlipped(false);
        if (studyIdx + 1 < studyDeck.cards.length) {
          setStudyIdx((i) => i + 1);
        } else {
          toast.success("Deck session complete!");
          setStudyDeck(null);
          loadAll();
        }
      } catch {
        toast.error("Could not save card rating");
      }
    },
    [studyDeck, studyIdx, loadAll],
  );

  // Keyboard shortcuts inside flashcard study modal
  useEffect(() => {
    if (!studyDeck) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.code === "Space" || e.key === "Enter") {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (flipped) {
        if (e.key === "1") rateCard("AGAIN");
        else if (e.key === "2") rateCard("HARD");
        else if (e.key === "3") rateCard("GOOD");
        else if (e.key === "4") rateCard("EASY");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [studyDeck, flipped, rateCard]);

  async function deleteDeck(deckId: string) {
    await fetch(`/api/flashcards?deckId=${encodeURIComponent(deckId)}`, {
      method: "DELETE",
    });
    toast.success("Deck deleted");
    loadAll();
  }

  async function saveSamplePaper(e: React.FormEvent) {
    e.preventDefault();
    if (!pyqFile && !pyqText.trim()) {
      toast.error("Upload a PYQ file or paste sample paper text");
      return;
    }
    setSavingPyq(true);
    try {
      const fd = new FormData();
      fd.append("title", pyqTitle.trim());
      fd.append("subjectId", pyqSubjectId);
      if (pyqFile) fd.append("file", pyqFile);
      else fd.append("text", pyqText);

      const res = await fetch("/api/sample-papers", {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Upload failed");
      toast.success("Sample / PYQ Paper saved!");
      setPyqOpen(false);
      setPyqTitle("");
      setPyqFile(null);
      setPyqText("");
      await loadAll();
      if (json.samplePaper?.id) {
        setExSampleId(json.samplePaper.id);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save PYQ");
    } finally {
      setSavingPyq(false);
    }
  }

  async function deleteSamplePaper(id: string) {
    await fetch(`/api/sample-papers?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    toast.success("Sample paper deleted");
    loadAll();
  }

  async function handleGenerateExam(e: React.FormEvent) {
    e.preventDefault();
    if (!exSubjectId) {
      toast.error("Select a Subject first");
      return;
    }
    const subName =
      subjects.find((s) => s.id === exSubjectId)?.name || "Subject";
    setGeneratingExam(true);
    try {
      await startAiTask({
        id: "mock-exam-gen",
        feature: "mock_exam_generate",
        title: "PYQ Mock Exam Setter",
        subtitle: `Crafting ${exMarks}-mark paper for ${subName}...`,
        actionLabel: "Open Paper",
        actionHref: "/practice",
        run: async (signal) => {
          const res = await fetch("/api/mock-exams", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal,
            body: JSON.stringify({
              subjectId: exSubjectId,
              moduleId: exModuleId === "ALL" ? null : exModuleId,
              samplePaperId: exSampleId === "NONE" ? null : exSampleId,
              totalMarks: Number(exMarks) || 50,
              durationMinutes: Number(exDuration) || 90,
              focusInstructions: exInstructions.trim() || undefined,
            }),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || "Generation failed");
          return json.mockExam as MockExam;
        },
        onComplete: (exam) => {
          toast.success("Mock Exam generated!");
          openExamRunner(exam);
          loadAll();
        },
        onOpenResult: (exam) => {
          openExamRunner(exam);
        },
      });
    } finally {
      setGeneratingExam(false);
    }
  }

  function stopExamGeneration() {
    stopAiTask("mock-exam-gen");
    exAbortRef.current?.abort();
  }

  function openExamRunner(exam: MockExam) {
    setActiveExam(exam);
    setRevealedAnswers({});
    setExamSecondsLeft(exam.durationMinutes * 60);
    setExamRunning(false);
    setScoreInput(exam.score !== null ? String(exam.score) : "");
    setCopiedPaper(false);
  }

  async function saveExamScore() {
    if (!activeExam) return;
    const score = Number(scoreInput);
    if (isNaN(score) || score < 0) return;
    const res = await fetch("/api/mock-exams", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: activeExam.id, score }),
    });
    if (res.ok) {
      toast.success("Score recorded!");
      loadAll();
    }
  }

  async function deleteMockExam(id: string) {
    await fetch(`/api/mock-exams?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    toast.success("Mock exam deleted");
    loadAll();
  }

  const selectedFcSubject = subjects.find((s) => s.id === fcSubjectId);
  const selectedExSubject = subjects.find((s) => s.id === exSubjectId);
  const matchingSamplePapers = samplePapers.filter(
    (p) => !p.subjectId || p.subjectId === exSubjectId,
  );

  let activeParsedExam: ParsedExamContent | null = null;
  if (activeExam) {
    try {
      activeParsedExam = JSON.parse(activeExam.examContent);
    } catch {
      activeParsedExam = null;
    }
  }

  const allQuestionsRevealed =
    Boolean(activeParsedExam) &&
    activeParsedExam!.sections.every((sec, sIdx) =>
      sec.questions.every((_, qIdx) => Boolean(revealedAnswers[`${sIdx}-${qIdx}`])),
    );

  function toggleAllExamAnswers() {
    if (!activeParsedExam) return;
    if (allQuestionsRevealed) {
      setRevealedAnswers({});
      return;
    }
    const next: Record<string, boolean> = {};
    activeParsedExam.sections.forEach((sec, sIdx) => {
      sec.questions.forEach((_, qIdx) => {
        next[`${sIdx}-${qIdx}`] = true;
      });
    });
    setRevealedAnswers(next);
  }

  async function copyExamPaper() {
    if (!activeExam || !activeParsedExam) return;
    const lines: string[] = [
      `# ${activeExam.title}`,
      `${activeExam.totalMarks} Marks | ${activeExam.durationMinutes} Minutes`,
      "",
    ];
    for (const [sIdx, sec] of activeParsedExam.sections.entries()) {
      lines.push(`## ${sec.title}`);
      if (sec.instructions) lines.push(sec.instructions);
      lines.push("");
      for (const [qIdx, q] of sec.questions.entries()) {
        lines.push(`**Q${q.number}** (${q.marks} Marks): ${q.question}`);
        if (allQuestionsRevealed || revealedAnswers[`${sIdx}-${qIdx}`]) {
          lines.push(`> Model Answer: ${q.modelAnswer}`);
        }
        lines.push("");
      }
    }
    await navigator.clipboard.writeText(lines.join("\n"));
    setCopiedPaper(true);
    toast.success("Exam paper copied to clipboard");
    setTimeout(() => setCopiedPaper(false), 2000);
  }

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-end justify-between gap-4"
      >
        <div>
          <StudyHeroEmblem icon={Layers} eyebrow="Active Recall & Assessment" accentColor="emerald" />
          <h1 className="text-2xl sm:text-3xl font-bold">
            AI <span className="gradient-text">Practice Studio</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Spaced-repetition Flashcards & PYQ-matched Mock Exams built from your
            notes and syllabus
          </p>
        </div>
        <AiLogsButton />
      </motion.div>

      <Tabs defaultValue="flashcards" className="space-y-5">
        <TabsList>
          <TabsTrigger value="flashcards" className="gap-1.5">
            <Layers className="h-4 w-4" />
            AI Flashcards ({decks.length})
          </TabsTrigger>
          <TabsTrigger value="mock-exams" className="gap-1.5">
            <FileCheck2 className="h-4 w-4" />
            PYQ Mock Exams ({mockExams.length})
          </TabsTrigger>
        </TabsList>

        {/* ─── TAB 1: FLASHCARDS ─────────────────────────────────────────── */}
        <TabsContent value="flashcards" className="space-y-6 mt-0">
          <div className="studio-shell gradient-border p-5 sm:p-6">
            <form
              onSubmit={handleGenerateDeck}
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-4 items-end"
            >
              <div className="flex flex-col gap-1.5 lg:col-span-4">
                <Label className="text-xs leading-none">Subject</Label>
                <Select
                  value={fcSubjectId}
                  onValueChange={(v) => {
                    setFcSubjectId(v);
                    setFcModuleId("ALL");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select subject" />
                  </SelectTrigger>
                  <SelectContent>
                    {subjects.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5 lg:col-span-4">
                <Label className="text-xs leading-none">Module Scope</Label>
                <Select value={fcModuleId} onValueChange={setFcModuleId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">
                      All Modules (Prioritize Remaining)
                    </SelectItem>
                    {(selectedFcSubject?.modules || []).map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5 lg:col-span-2">
                <Label className="text-xs leading-none">Cards</Label>
                <Select
                  value={String(fcCount)}
                  onValueChange={(v) => setFcCount(Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="6">6 Cards</SelectItem>
                    <SelectItem value="10">10 Cards</SelectItem>
                    <SelectItem value="15">15 Cards</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5 lg:col-span-2">
                <span
                  aria-hidden="true"
                  className="hidden lg:block text-xs leading-none opacity-0 select-none"
                >
                  Action
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="submit"
                    variant="glow"
                    className="flex-1 h-10"
                    disabled={generatingDeck}
                  >
                    {generatingDeck ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {aiElapsed}s
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" /> Generate
                      </>
                    )}
                  </Button>
                  {generatingDeck && (
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon"
                      className="h-10 w-10 shrink-0"
                      onClick={stopDeckGeneration}
                      title="Stop generation"
                    >
                      <Square className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </form>
          </div>

          {loading ? (
            <div className="h-44 rounded-xl shimmer" />
          ) : decks.length === 0 ? (
            <Card className="p-10 sm:p-12 text-center space-y-3">
              <OrbitalIllustration className="h-24 w-24 mx-auto animate-float" />
              <div className="space-y-1">
                <h3 className="text-lg font-semibold">No flashcard decks yet</h3>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  Pick a subject above to generate spaced-repetition cards from
                  your remaining topics and uploaded notes.
                </p>
              </div>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {decks.map((deck) => {
                const dueCount = deck.cards.filter(
                  (c) => new Date(c.nextReviewAt) <= new Date(),
                ).length;

                return (
                  <Card
                    key={deck.id}
                    className="p-5 sm:p-6 flex flex-col justify-between gap-4 hover:border-primary/40 transition-colors"
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-semibold text-base text-foreground leading-snug">
                          {deck.title}
                        </h3>
                        <button
                          onClick={() => deleteDeck(deck.id)}
                          className="text-muted-foreground hover:text-destructive cursor-pointer shrink-0 p-1 -m-1"
                          aria-label="Delete deck"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {deck.subject && (
                          <Badge
                            variant="outline"
                            style={{
                              borderColor: `${deck.subject.color}60`,
                              color: deck.subject.color,
                            }}
                          >
                            {deck.subject.code || deck.subject.name}
                          </Badge>
                        )}
                        <Badge variant="outline">
                          {deck.cards.length} cards
                        </Badge>
                        {dueCount > 0 && (
                          <Badge variant="default">{dueCount} due</Badge>
                        )}
                      </div>
                      {deck.source && (
                        <p className="text-xs text-muted-foreground truncate">
                          Source: {deck.source}
                        </p>
                      )}
                    </div>

                    <Button
                      variant="glow"
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        setStudyDeck(deck);
                        setStudyIdx(0);
                        setFlipped(false);
                      }}
                    >
                      Study Deck
                    </Button>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ─── TAB 2: PYQ MOCK EXAMS ─────────────────────────────────────── */}
        <TabsContent value="mock-exams" className="space-y-6 mt-0">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-stretch">
            {/* Generator Form */}
            <div className="studio-shell gradient-border lg:col-span-2 p-5 sm:p-6 flex flex-col justify-between space-y-5">
              <div className="flex items-start justify-between flex-wrap gap-3">
                <div>
                  <h3 className="font-semibold text-base">
                    Generate PYQ-Matched Mock Paper
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Mimics your uploaded Previous Year / Sample Question Paper
                    pattern using your scoped syllabus &amp; lecture notes.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setPyqSubjectId(exSubjectId || "NONE");
                    setPyqOpen(true);
                  }}
                >
                  <Upload className="h-3.5 w-3.5 text-primary" /> Upload PYQ
                </Button>
              </div>

              <form onSubmit={handleGenerateExam} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs leading-none">Subject</Label>
                    <Select
                      value={exSubjectId}
                      onValueChange={(v) => {
                        setExSubjectId(v);
                        setExModuleId("ALL");
                        setExSampleId("NONE");
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select subject" />
                      </SelectTrigger>
                      <SelectContent>
                        {subjects.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs leading-none">Module Scope</Label>
                    <Select value={exModuleId} onValueChange={setExModuleId}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">All Modules</SelectItem>
                        {(selectedExSubject?.modules || []).map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs leading-none">PYQ Pattern</Label>
                    <Select value={exSampleId} onValueChange={setExSampleId}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NONE">
                          Standard Pattern
                        </SelectItem>
                        {matchingSamplePapers.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs leading-none">Total Marks</Label>
                    <Input
                      type="number"
                      min={10}
                      max={200}
                      value={exMarks}
                      onChange={(e) => setExMarks(Number(e.target.value))}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs leading-none">Duration (min)</Label>
                    <Input
                      type="number"
                      min={15}
                      max={240}
                      value={exDuration}
                      onChange={(e) => setExDuration(Number(e.target.value))}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5 col-span-2 sm:col-span-1">
                    <Label className="text-xs leading-none">Focus (optional)</Label>
                    <Input
                      placeholder="e.g. Derivations & proofs"
                      value={exInstructions}
                      onChange={(e) => setExInstructions(e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2.5 pt-1">
                  <Button type="submit" variant="glow" disabled={generatingExam}>
                    {generatingExam ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Generating Mock Paper ({aiElapsed}s)
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" /> Generate Mock Exam
                      </>
                    )}
                  </Button>
                  {generatingExam && (
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={stopExamGeneration}
                    >
                      <Square className="h-3.5 w-3.5" /> Stop
                    </Button>
                  )}
                </div>
              </form>
            </div>

            {/* Saved PYQs List */}
            <div className="studio-shell p-5 sm:p-6 flex flex-col justify-between space-y-3">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-base">Saved PYQ Papers</h3>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => {
                      setPyqSubjectId(exSubjectId || "NONE");
                      setPyqOpen(true);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" /> Add
                  </Button>
                </div>
                {samplePapers.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-6 leading-relaxed">
                    Upload previous year papers (PDF/DOCX/TXT) so AI matches your
                    university&apos;s exact question style & mark distribution.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-[250px] overflow-y-auto pr-1">
                    {samplePapers.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between gap-2 rounded-xl border border-glass-border/60 bg-muted/35 p-3 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="font-medium truncate">{p.title}</p>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {p.subject?.name || "General"}
                          </p>
                        </div>
                        <button
                          onClick={() => deleteSamplePaper(p.id)}
                          className="text-muted-foreground hover:text-destructive cursor-pointer shrink-0 p-1"
                          aria-label="Delete PYQ paper"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground pt-2 border-t border-glass-border/50">
                {samplePapers.length} sample paper{samplePapers.length === 1 ? "" : "s"} stored
              </p>
            </div>
          </div>

          {/* Past Mock Exams */}
          {mockExams.length === 0 && !loading ? (
            <Card className="p-10 text-center space-y-2">
              <FileCheck2 className="h-9 w-9 text-muted-foreground mx-auto" />
              <h3 className="text-base font-semibold">No mock exams yet</h3>
              <p className="text-xs text-muted-foreground max-w-md mx-auto">
                Configure your subject, module scope, marks, and optional PYQ pattern above to generate a timed practice paper with a complete answer key.
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {mockExams.map((ex) => (
                <Card
                  key={ex.id}
                  className="p-5 sm:p-6 flex flex-col justify-between gap-4 hover:border-primary/40 transition-colors"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-base text-foreground leading-snug">
                        {ex.title}
                      </h3>
                      <button
                        onClick={() => deleteMockExam(ex.id)}
                        className="text-muted-foreground hover:text-destructive cursor-pointer shrink-0 p-1 -m-1"
                        aria-label="Delete mock exam"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {ex.subject && (
                        <Badge variant="outline">
                          {ex.subject.code || ex.subject.name}
                        </Badge>
                      )}
                      <Badge variant="outline">{ex.totalMarks} Marks</Badge>
                      <Badge variant="outline">{ex.durationMinutes} min</Badge>
                      {ex.score !== null && (
                        <Badge variant="success">
                          Score: {ex.score}/{ex.totalMarks}
                        </Badge>
                      )}
                    </div>
                    {ex.samplePaper && (
                      <p className="text-xs text-accent truncate">
                        Pattern: {ex.samplePaper.title}
                      </p>
                    )}
                    <p className="text-[11px] text-muted-foreground">
                      {formatDate(ex.createdAt)}
                    </p>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => openExamRunner(ex)}
                  >
                    Open Exam Paper
                  </Button>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ─── FLASHCARD STUDY MODAL (3D Fixed-Height Flip) ────────────────── */}
      <Dialog
        open={Boolean(studyDeck)}
        onOpenChange={(o) => !o && setStudyDeck(null)}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="truncate">{studyDeck?.title}</DialogTitle>
            <DialogDescription>
              Card {studyIdx + 1} of {studyDeck?.cards.length || 0} • Press{" "}
              <kbd className="rounded border border-glass-border px-1 py-0.5 text-[10px]">
                Space
              </kbd>{" "}
              or click card to flip
            </DialogDescription>
          </DialogHeader>

          {studyDeck && studyDeck.cards[studyIdx] && (
            <div className="space-y-4">
              {/* Session Progress Bar + Prev/Next */}
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="h-7 w-7 shrink-0"
                  disabled={studyIdx === 0}
                  onClick={() => {
                    setFlipped(false);
                    setStudyIdx((i) => Math.max(0, i - 1));
                  }}
                  title="Previous card"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-primary to-accent transition-all duration-300"
                    style={{
                      width: `${((studyIdx + 1) / Math.max(1, studyDeck.cards.length)) * 100}%`,
                    }}
                  />
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="h-7 w-7 shrink-0"
                  disabled={studyIdx + 1 >= studyDeck.cards.length}
                  onClick={() => {
                    setFlipped(false);
                    setStudyIdx((i) =>
                      Math.min(studyDeck.cards.length - 1, i + 1),
                    );
                  }}
                  title="Skip to next card"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>

              {/* Fixed-Height 3D Perspective Flip Container */}
              <div className="perspective-1200 h-[290px] sm:h-[310px] w-full">
                <div
                  onClick={() => setFlipped((f) => !f)}
                  className={cn(
                    "relative h-full w-full preserve-3d cursor-pointer",
                    flipped && "rotate-y-180",
                  )}
                >
                  {/* FRONT FACE (Question) */}
                  <div className="absolute inset-0 backface-hidden rounded-2xl border border-primary/40 bg-gradient-to-br from-[#161634] to-[#0f0f24] p-5 sm:p-6 flex flex-col justify-between shadow-xl">
                    <div className="flex items-center justify-between text-xs text-muted-foreground gap-2 shrink-0">
                      <Badge variant="outline" className="border-primary/40 text-primary">
                        Question Prompt
                      </Badge>
                      {studyDeck.cards[studyIdx].topicTag && (
                        <span className="text-accent truncate max-w-[60%]">
                          {studyDeck.cards[studyIdx].topicTag}
                        </span>
                      )}
                    </div>

                    <div className="flex-1 overflow-y-auto my-3 pr-1 flex items-center">
                      <div className="w-full text-base">
                        <MarkdownRenderer
                          content={studyDeck.cards[studyIdx].front}
                        />
                      </div>
                    </div>

                    <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 justify-end shrink-0">
                      <RotateCw className="h-3 w-3" /> Click card or press Space to reveal answer
                    </p>
                  </div>

                  {/* BACK FACE (Answer) */}
                  <div className="absolute inset-0 backface-hidden rotate-y-180 rounded-2xl border border-emerald-500/45 bg-gradient-to-br from-[#102124] to-[#0e1528] p-5 sm:p-6 flex flex-col justify-between shadow-xl">
                    <div className="flex items-center justify-between text-xs text-muted-foreground gap-2 shrink-0">
                      <Badge variant="success">Answer &amp; Key Formula</Badge>
                      {studyDeck.cards[studyIdx].topicTag && (
                        <span className="text-emerald-300/80 truncate max-w-[60%]">
                          {studyDeck.cards[studyIdx].topicTag}
                        </span>
                      )}
                    </div>

                    <div className="flex-1 overflow-y-auto my-3 pr-1">
                      <MarkdownRenderer
                        content={studyDeck.cards[studyIdx].back}
                      />
                    </div>

                    <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 justify-end shrink-0">
                      <RotateCw className="h-3 w-3" /> Rate recall below (or press 1–4)
                    </p>
                  </div>
                </div>
              </div>

              {/* Fixed-Height Footer Action Slot (buttons never shift!) */}
              <div className="min-h-[54px] flex items-center">
                {flipped ? (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 w-full">
                    <button
                      type="button"
                      onClick={() => rateCard("AGAIN")}
                      className="rounded-xl border border-destructive/40 bg-destructive/15 hover:bg-destructive/25 px-2.5 py-2 text-center transition-colors cursor-pointer"
                    >
                      <span className="block text-xs font-semibold text-red-300">
                        1 · Forgot
                      </span>
                      <span className="block text-[10px] text-red-300/75">
                        Reset · 10m
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => rateCard("HARD")}
                      className="rounded-xl border border-amber-500/40 bg-amber-500/15 hover:bg-amber-500/25 px-2.5 py-2 text-center transition-colors cursor-pointer"
                    >
                      <span className="block text-xs font-semibold text-amber-300">
                        2 · Shaky
                      </span>
                      <span className="block text-[10px] text-amber-300/75">
                        Review · 1d
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => rateCard("GOOD")}
                      className="rounded-xl border border-primary/50 bg-primary/20 hover:bg-primary/30 px-2.5 py-2 text-center transition-colors cursor-pointer"
                    >
                      <span className="block text-xs font-semibold text-accent">
                        3 · Got It
                      </span>
                      <span className="block text-[10px] text-accent/80">
                        Normal · 3–6d
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => rateCard("EASY")}
                      className="rounded-xl border border-emerald-500/45 bg-emerald-500/15 hover:bg-emerald-500/25 px-2.5 py-2 text-center transition-colors cursor-pointer"
                    >
                      <span className="block text-xs font-semibold text-emerald-300">
                        4 · Mastered
                      </span>
                      <span className="block text-[10px] text-emerald-300/75">
                        Push far
                      </span>
                    </button>
                  </div>
                ) : (
                  <Button
                    className="w-full h-11"
                    variant="glow"
                    onClick={() => setFlipped(true)}
                  >
                    <RotateCw className="h-4 w-4" /> Flip Card &amp; Check Answer
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ─── UPLOAD PYQ PAPER MODAL ──────────────────────────────────────── */}
      <Dialog open={pyqOpen} onOpenChange={setPyqOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload Sample / PYQ Question Paper</DialogTitle>
            <DialogDescription>
              AI uses this paper&apos;s sections, mark distribution, and style to
              craft realistic mock exams.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveSamplePaper} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input
                placeholder="e.g., Dec 2025 End-Sem Paper"
                value={pyqTitle}
                onChange={(e) => setPyqTitle(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Subject</Label>
              <Select value={pyqSubjectId} onValueChange={setPyqSubjectId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">All / General</SelectItem>
                  {subjects.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => pyqFileRef.current?.click()}
              >
                <Upload className="h-4 w-4" />
                {pyqFile ? pyqFile.name : "Choose PDF / DOCX / TXT"}
              </Button>
              <input
                ref={pyqFileRef}
                type="file"
                accept=".pdf,.docx,.pptx,.txt,.md"
                className="hidden"
                onChange={(e) => setPyqFile(e.target.files?.[0] || null)}
              />
            </div>

            {!pyqFile && (
              <div className="space-y-1.5">
                <Label>Or paste sample paper text</Label>
                <Textarea
                  rows={5}
                  placeholder="Part A (5x2=10M): 1. Define... Part B (4x10=40M): ..."
                  value={pyqText}
                  onChange={(e) => setPyqText(e.target.value)}
                />
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPyqOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="glow" disabled={savingPyq}>
                {savingPyq ? "Saving..." : "Save PYQ Paper"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ─── MOCK EXAM PAPER VIEWER / RUNNER ─────────────────────────────── */}
      <Dialog
        open={Boolean(activeExam)}
        onOpenChange={(o) => {
          if (!o) {
            setActiveExam(null);
            setExamRunning(false);
          }
        }}
      >
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{activeExam?.title}</DialogTitle>
            <DialogDescription>
              {activeExam?.totalMarks} Marks • {activeExam?.durationMinutes}{" "}
              Minutes
              {activeParsedExam?.patternNotes
                ? ` — ${activeParsedExam.patternNotes}`
                : ""}
            </DialogDescription>
          </DialogHeader>

          {activeExam && activeParsedExam && (
            <div className="space-y-5">
              {/* Timer + Paper Controls + Self-Grade Bar */}
              <div className="flex flex-col gap-3 rounded-xl border border-glass-border bg-muted/35 p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-primary" />
                    <span className="font-mono font-bold text-base">
                      {formatDuration(examSecondsLeft)}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={() => setExamRunning(!examRunning)}
                    >
                      {examRunning ? "Pause" : "Start Timer"}
                    </Button>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={toggleAllExamAnswers}
                    >
                      {allQuestionsRevealed ? (
                        <>
                          <EyeOff className="h-3.5 w-3.5" /> Hide All Keys
                        </>
                      ) : (
                        <>
                          <Eye className="h-3.5 w-3.5" /> Reveal All Keys
                        </>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={copyExamPaper}
                    >
                      {copiedPaper ? (
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      {copiedPaper ? "Copied" : "Copy Paper"}
                    </Button>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-glass-border/50 flex-wrap">
                  <span className="text-xs text-muted-foreground">
                    Self-grade your attempt after revealing the marking scheme:
                  </span>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      placeholder={`Score / ${activeExam.totalMarks}`}
                      value={scoreInput}
                      onChange={(e) => setScoreInput(e.target.value)}
                      className="w-28 h-8 text-xs"
                    />
                    <Button size="sm" variant="glow" className="h-8 text-xs" onClick={saveExamScore}>
                      <CheckCircle2 className="h-3.5 w-3.5" /> Save Score
                    </Button>
                  </div>
                </div>
              </div>

              {/* Exam Sections */}
              <div className="space-y-6">
                {activeParsedExam.sections.map((sec, sIdx) => (
                  <div key={sIdx} className="space-y-3">
                    <div className="border-b border-glass-border pb-2">
                      <h3 className="font-semibold text-base text-accent">
                        {sec.title}
                      </h3>
                      {sec.instructions && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {sec.instructions}
                        </p>
                      )}
                    </div>

                    <div className="space-y-3">
                      {sec.questions.map((q, qIdx) => {
                        const key = `${sIdx}-${qIdx}`;
                        const shown = Boolean(revealedAnswers[key]);
                        return (
                          <div
                            key={key}
                            className="rounded-xl border border-glass-border/70 bg-muted/30 p-4 space-y-3"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 space-y-1 min-w-0">
                                <span className="text-xs font-semibold text-primary">
                                  Q{q.number}
                                </span>
                                <MarkdownRenderer content={q.question} />
                              </div>
                              <Badge variant="outline" className="shrink-0">
                                {q.marks} Marks
                              </Badge>
                            </div>

                            <div className="flex justify-end">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs text-accent"
                                onClick={() =>
                                  setRevealedAnswers((p) => ({
                                    ...p,
                                    [key]: !shown,
                                  }))
                                }
                              >
                                {shown ? (
                                  <>
                                    <EyeOff className="h-3.5 w-3.5" /> Hide
                                    Answer Key
                                  </>
                                ) : (
                                  <>
                                    <Eye className="h-3.5 w-3.5" /> Reveal
                                    Model Answer
                                  </>
                                )}
                              </Button>
                            </div>

                            {shown && (
                              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3.5 space-y-2">
                                <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
                                  Model Answer
                                </p>
                                <MarkdownRenderer content={q.modelAnswer} />
                                {q.markingScheme && (
                                  <p className="text-xs text-muted-foreground pt-1 border-t border-emerald-500/20">
                                    Marking Scheme: {q.markingScheme}
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
