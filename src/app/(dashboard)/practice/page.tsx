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
import { formatDate, formatDuration } from "@/lib/utils";
import { StudyHeroEmblem, OrbitalIllustration } from "@/components/ui/study-emblem";

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
  const [exSubjectId, setExSubjectId] = useState("");
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

  async function handleGenerateDeck(e: React.FormEvent) {
    e.preventDefault();
    if (!fcSubjectId) {
      toast.error("Create/select a Subject first");
      return;
    }
    setGeneratingDeck(true);
    try {
      const res = await fetch("/api/flashcards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectId: fcSubjectId,
          moduleId: fcModuleId === "ALL" ? null : fcModuleId,
          count: fcCount,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to generate deck");
      toast.success(`Created "${json.deck.title}" (${json.deck.cards.length} cards)`);
      loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Deck generation failed");
    } finally {
      setGeneratingDeck(false);
    }
  }

  async function rateCard(quality: "AGAIN" | "HARD" | "GOOD" | "EASY") {
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
  }

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
    setGeneratingExam(true);
    try {
      const res = await fetch("/api/mock-exams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectId: exSubjectId,
          samplePaperId: exSampleId === "NONE" ? null : exSampleId,
          totalMarks: Number(exMarks) || 50,
          durationMinutes: Number(exDuration) || 90,
          focusInstructions: exInstructions.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Generation failed");
      toast.success("Mock Exam generated!");
      openExamRunner(json.mockExam);
      loadAll();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Mock exam generation failed",
      );
    } finally {
      setGeneratingExam(false);
    }
  }

  function openExamRunner(exam: MockExam) {
    setActiveExam(exam);
    setRevealedAnswers({});
    setExamSecondsLeft(exam.durationMinutes * 60);
    setExamRunning(false);
    setScoreInput(exam.score !== null ? String(exam.score) : "");
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

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <StudyHeroEmblem icon={Layers} eyebrow="Active Recall & Assessment" accentColor="emerald" />
        <h1 className="text-2xl sm:text-3xl font-bold">
          AI <span className="gradient-text">Practice Studio</span>
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Spaced-repetition Flashcards & PYQ-matched Mock Exams built from your
          notes and syllabus
        </p>
      </motion.div>

      <Tabs defaultValue="flashcards">
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
        <TabsContent value="flashcards" className="space-y-6">
          <Card className="p-5 gradient-border">
            <form
              onSubmit={handleGenerateDeck}
              className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end"
            >
              <div className="space-y-1.5">
                <Label className="text-xs">Subject</Label>
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

              <div className="space-y-1.5">
                <Label className="text-xs">Module Scope</Label>
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

              <div className="space-y-1.5">
                <Label className="text-xs">Cards</Label>
                <Select
                  value={String(fcCount)}
                  onValueChange={(v) => setFcCount(Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="6">6 Cards (Quick)</SelectItem>
                    <SelectItem value="10">10 Cards (Standard)</SelectItem>
                    <SelectItem value="15">15 Cards (Deep)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button type="submit" variant="glow" disabled={generatingDeck}>
                {generatingDeck ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generating ({aiElapsed}s)
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" /> Generate Deck
                  </>
                )}
              </Button>
            </form>
          </Card>

          {loading ? (
            <div className="h-44 rounded-xl shimmer" />
          ) : decks.length === 0 ? (
            <Card className="p-12 text-center space-y-2">
              <OrbitalIllustration className="h-24 w-24 mx-auto animate-float" />
              <h3 className="text-lg font-semibold">No flashcard decks yet</h3>
              <p className="text-sm text-muted-foreground">
                Pick a subject above to generate spaced-repetition cards from
                your remaining topics and uploaded notes.
              </p>
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
                    className="p-5 flex flex-col justify-between gap-4"
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-semibold text-base text-foreground">
                          {deck.title}
                        </h3>
                        <button
                          onClick={() => deleteDeck(deck.id)}
                          className="text-muted-foreground hover:text-destructive cursor-pointer shrink-0"
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
                            {deck.subject.name}
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
        <TabsContent value="mock-exams" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            {/* Generator Form */}
            <Card className="lg:col-span-2 p-5 gradient-border space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h3 className="font-semibold text-base">
                    Generate PYQ-Matched Mock Paper
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Mimics your uploaded Previous Year / Sample Question Paper
                    pattern using your lecture notes.
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
                  Paper
                </Button>
              </div>

              <form onSubmit={handleGenerateExam} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Subject</Label>
                    <Select
                      value={exSubjectId}
                      onValueChange={(v) => {
                        setExSubjectId(v);
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

                  <div className="space-y-1.5">
                    <Label className="text-xs">
                      Sample / PYQ Paper Pattern
                    </Label>
                    <Select value={exSampleId} onValueChange={setExSampleId}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NONE">
                          Standard University Pattern
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
                  <div className="space-y-1.5">
                    <Label className="text-xs">Total Marks</Label>
                    <Input
                      type="number"
                      min={10}
                      max={200}
                      value={exMarks}
                      onChange={(e) => setExMarks(Number(e.target.value))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Duration (min)</Label>
                    <Input
                      type="number"
                      min={15}
                      max={240}
                      value={exDuration}
                      onChange={(e) => setExDuration(Number(e.target.value))}
                    />
                  </div>
                  <div className="space-y-1.5 col-span-2 sm:col-span-1">
                    <Label className="text-xs">Focus (optional)</Label>
                    <Input
                      placeholder="e.g. Modules 1-3"
                      value={exInstructions}
                      onChange={(e) => setExInstructions(e.target.value)}
                    />
                  </div>
                </div>

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
              </form>
            </Card>

            {/* Saved PYQs List */}
            <Card className="p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm">Saved PYQ Papers</h3>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPyqOpen(true)}
                >
                  <Plus className="h-3.5 w-3.5" /> Add
                </Button>
              </div>
              {samplePapers.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4">
                  Upload previous year papers (PDF/DOCX/TXT) so AI matches your
                  university&apos;s exact question style & mark distribution.
                </p>
              ) : (
                <div className="space-y-2 max-h-[240px] overflow-y-auto">
                  {samplePapers.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-glass-border/60 bg-muted/40 p-2.5 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-medium truncate">{p.title}</p>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {p.subject?.name || "General"}
                        </p>
                      </div>
                      <button
                        onClick={() => deleteSamplePaper(p.id)}
                        className="text-muted-foreground hover:text-destructive cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* Past Mock Exams */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {mockExams.map((ex) => (
              <Card
                key={ex.id}
                className="p-5 flex flex-col justify-between gap-4"
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-base text-foreground">
                      {ex.title}
                    </h3>
                    <button
                      onClick={() => deleteMockExam(ex.id)}
                      className="text-muted-foreground hover:text-destructive cursor-pointer shrink-0"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {ex.subject && (
                      <Badge variant="outline">{ex.subject.name}</Badge>
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
                  onClick={() => openExamRunner(ex)}
                >
                  Open Exam Paper
                </Button>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* ─── FLASHCARD STUDY MODAL ───────────────────────────────────────── */}
      <Dialog
        open={Boolean(studyDeck)}
        onOpenChange={(o) => !o && setStudyDeck(null)}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{studyDeck?.title}</DialogTitle>
            <DialogDescription>
              Card {studyIdx + 1} of {studyDeck?.cards.length || 0} • Click card
              to flip
            </DialogDescription>
          </DialogHeader>

          {studyDeck && studyDeck.cards[studyIdx] && (
            <div className="space-y-4">
              <div
                onClick={() => setFlipped(!flipped)}
                className="min-h-[240px] rounded-2xl border border-primary/40 bg-muted/50 p-6 flex flex-col justify-between cursor-pointer hover:border-primary transition-colors"
              >
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <Badge variant="outline">
                    {flipped ? "Answer" : "Question"}
                  </Badge>
                  {studyDeck.cards[studyIdx].topicTag && (
                    <span className="text-accent">
                      {studyDeck.cards[studyIdx].topicTag}
                    </span>
                  )}
                </div>

                <div className="my-4">
                  <MarkdownRenderer
                    content={
                      flipped
                        ? studyDeck.cards[studyIdx].back
                        : studyDeck.cards[studyIdx].front
                    }
                  />
                </div>

                <p className="text-[11px] text-muted-foreground flex items-center gap-1 justify-end">
                  <RotateCw className="h-3 w-3" /> Click to flip
                </p>
              </div>

              {flipped ? (
                <div className="grid grid-cols-4 gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => rateCard("AGAIN")}
                  >
                    Again (10m)
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => rateCard("HARD")}
                  >
                    Hard
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => rateCard("GOOD")}
                  >
                    Good
                  </Button>
                  <Button
                    variant="glow"
                    size="sm"
                    onClick={() => rateCard("EASY")}
                  >
                    Easy
                  </Button>
                </div>
              ) : (
                <Button
                  className="w-full"
                  variant="glow"
                  onClick={() => setFlipped(true)}
                >
                  Show Answer
                </Button>
              )}
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
              {/* Timer + Self-Grade Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-glass-border bg-muted/40 p-3">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-primary" />
                  <span className="font-mono font-bold text-base">
                    {formatDuration(examSecondsLeft)}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setExamRunning(!examRunning)}
                  >
                    {examRunning ? "Pause" : "Start Timer"}
                  </Button>
                </div>

                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    placeholder={`Score / ${activeExam.totalMarks}`}
                    value={scoreInput}
                    onChange={(e) => setScoreInput(e.target.value)}
                    className="w-28 h-8"
                  />
                  <Button size="sm" variant="glow" onClick={saveExamScore}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Save Score
                  </Button>
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
                        <p className="text-xs text-muted-foreground">
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
                            className="rounded-xl border border-glass-border/70 bg-muted/35 p-4 space-y-3"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 space-y-1">
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
