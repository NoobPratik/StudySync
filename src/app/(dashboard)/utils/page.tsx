"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  CheckSquare,
  StickyNote,
  Clock,
  Plus,
  Trash2,
  CheckCircle2,
  Circle,
  Pin,
  Save,
  Wand2,
  Loader2,
  Wrench,
  Edit2,
  Copy,
  Eye,
  RotateCcw,
} from "lucide-react";
import { StudyHeroEmblem } from "@/components/ui/study-emblem";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PomodoroWidget } from "@/components/pomodoro-widget";
import { cn, formatDate } from "@/lib/utils";

interface TodoItem {
  id: string;
  title: string;
  category: "GENERAL" | "COLLEGE" | "ERRAND" | "PERSONAL";
  isCompleted: boolean;
  dueDate: string | null;
}

interface ScratchNote {
  id: string;
  title: string;
  content: string;
  rawContent: string | null;
  color: string;
  pinned: boolean;
  updatedAt: string;
}

const NOTE_COLORS = [
  "#7C3AED",
  "#6366F1",
  "#10B981",
  "#F59E0B",
  "#EC4899",
];

export default function UtilitiesPage() {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [scratchNotes, setScratchNotes] = useState<ScratchNote[]>([]);
  const [loading, setLoading] = useState(true);

  // To-Do form
  const [todoTitle, setTodoTitle] = useState("");
  const [todoCat, setTodoCat] = useState<TodoItem["category"]>("COLLEGE");
  const [todoDue, setTodoDue] = useState("");
  const [todoFilter, setTodoFilter] = useState<"ALL" | "PENDING" | "DONE">(
    "ALL",
  );

  // Scratchpad form & Keep-style viewer modal
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [noteRawContent, setNoteRawContent] = useState<string | null>(null);
  const [noteColor, setNoteColor] = useState(NOTE_COLORS[0]);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [optimizing, setOptimizing] = useState(false);

  const [viewingNote, setViewingNote] = useState<ScratchNote | null>(null);
  const [viewMode, setViewMode] = useState<"OPTIMIZED" | "RAW">("OPTIMIZED");
  const [modalEditing, setModalEditing] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const [modalContent, setModalContent] = useState("");
  const [modalRawContent, setModalRawContent] = useState<string | null>(null);
  const [modalColor, setModalColor] = useState(NOTE_COLORS[0]);

  useEffect(() => {
    let active = true;
    Promise.all([fetch("/api/todos"), fetch("/api/scratchpad")])
      .then(async ([tRes, sRes]) => {
        if (!active) return;
        if (tRes.ok) {
          const tJson = await tRes.json();
          if (active) setTodos(tJson.todos || []);
        }
        if (sRes.ok) {
          const sJson = await sRes.json();
          if (active) setScratchNotes(sJson.scratchNotes || []);
        }
      })
      .catch(() => {
        if (active) toast.error("Failed to load utilities");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function addTodo(e: React.FormEvent) {
    e.preventDefault();
    if (!todoTitle.trim()) return;
    try {
      const res = await fetch("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: todoTitle.trim(),
          category: todoCat,
          dueDate: todoDue || null,
        }),
      });
      if (!res.ok) throw new Error();
      const json = await res.json();
      setTodos((prev) => [json.todo, ...prev]);
      setTodoTitle("");
      setTodoDue("");
    } catch {
      toast.error("Failed to add task");
    }
  }

  async function toggleTodo(item: TodoItem) {
    setTodos((prev) =>
      prev.map((t) =>
        t.id === item.id ? { ...t, isCompleted: !t.isCompleted } : t,
      ),
    );
    try {
      const res = await fetch(`/api/todos/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isCompleted: !item.isCompleted }),
      });
      if (!res.ok) throw new Error();
    } catch {
      toast.error("Could not update task");
    }
  }

  async function deleteTodo(id: string) {
    setTodos((prev) => prev.filter((t) => t.id !== id));
    await fetch(`/api/todos/${id}`, { method: "DELETE" }).catch(() => {});
  }

  async function saveScratchNote(e: React.FormEvent) {
    e.preventDefault();
    if (!noteTitle.trim()) {
      toast.error("Enter a note title");
      return;
    }

    try {
      const res = await fetch(
        editingNoteId ? `/api/scratchpad/${editingNoteId}` : "/api/scratchpad",
        {
          method: editingNoteId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: noteTitle.trim(),
            content: noteContent,
            rawContent: noteRawContent,
            color: noteColor,
          }),
        },
      );
      if (!res.ok) throw new Error();
      const json = await res.json();
      const saved: ScratchNote = json.scratchNote;

      setScratchNotes((prev) => {
        const next = editingNoteId
          ? prev.map((n) => (n.id === saved.id ? saved : n))
          : [saved, ...prev];
        return next.sort(
          (a, b) => Number(b.pinned) - Number(a.pinned),
        );
      });
      setEditingNoteId(null);
      setNoteTitle("");
      setNoteContent("");
      setNoteRawContent(null);
      toast.success(editingNoteId ? "Note updated" : "Brainstorm note saved");
    } catch {
      toast.error("Failed to save note");
    }
  }

  async function togglePin(note: ScratchNote) {
    try {
      const res = await fetch(`/api/scratchpad/${note.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: !note.pinned }),
      });
      if (!res.ok) throw new Error();
      const json = await res.json();
      const saved: ScratchNote = json.scratchNote;
      setScratchNotes((prev) =>
        prev
          .map((n) => (n.id === saved.id ? saved : n))
          .sort((a, b) => Number(b.pinned) - Number(a.pinned)),
      );
      if (viewingNote?.id === saved.id) setViewingNote(saved);
    } catch {
      toast.error("Failed to pin note");
    }
  }

  async function deleteScratchNote(id: string) {
    setScratchNotes((prev) => prev.filter((n) => n.id !== id));
    if (editingNoteId === id) {
      setEditingNoteId(null);
      setNoteTitle("");
      setNoteContent("");
      setNoteRawContent(null);
    }
    if (viewingNote?.id === id) setViewingNote(null);
    await fetch(`/api/scratchpad/${id}`, { method: "DELETE" }).catch(() => {});
  }

  async function handleOptimizeNote(target: "canvas" | "modal" = "canvas") {
    const srcTitle = target === "modal" ? modalTitle : noteTitle;
    const srcContent = target === "modal" ? modalContent : noteContent;
    if (!srcContent.trim()) {
      toast.info("Write some rough thoughts first before optimizing.");
      return;
    }

    setOptimizing(true);
    try {
      const res = await fetch("/api/ai/scratchpad/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: srcTitle, content: srcContent }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Optimization failed");

      if (target === "modal") {
        // Preserve original raw before replacing
        setModalRawContent((prev) => prev || srcContent);
        if (json.title) setModalTitle(json.title);
        if (json.content) setModalContent(json.content);
        setModalEditing(true);
      } else {
        setNoteRawContent((prev) => prev || srcContent);
        if (json.title) setNoteTitle(json.title);
        if (json.content) setNoteContent(json.content);
      }
      toast.success("Formatted & polished! Original raw draft preserved.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to optimize note",
      );
    } finally {
      setOptimizing(false);
    }
  }

  function openKeepNoteModal(note: ScratchNote) {
    setViewingNote(note);
    setViewMode("OPTIMIZED");
    setModalEditing(false);
    setModalTitle(note.title);
    setModalContent(note.content);
    setModalRawContent(note.rawContent || null);
    setModalColor(note.color);
  }

  async function saveModalEdit() {
    if (!viewingNote || !modalTitle.trim()) return;
    try {
      const res = await fetch(`/api/scratchpad/${viewingNote.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: modalTitle.trim(),
          content: modalContent,
          rawContent: modalRawContent,
          color: modalColor,
        }),
      });
      if (!res.ok) throw new Error();
      const json = await res.json();
      const saved: ScratchNote = json.scratchNote;
      setScratchNotes((prev) =>
        prev
          .map((n) => (n.id === saved.id ? saved : n))
          .sort((a, b) => Number(b.pinned) - Number(a.pinned)),
      );
      setViewingNote(saved);
      setModalEditing(false);
      toast.success("Note updated");
    } catch {
      toast.error("Failed to save note");
    }
  }

  const visibleTodos = todos.filter((t) => {
    if (todoFilter === "PENDING") return !t.isCompleted;
    if (todoFilter === "DONE") return t.isCompleted;
    return true;
  });

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <StudyHeroEmblem icon={Wrench} eyebrow="Productivity Suite" accentColor="indigo" />
        <h1 className="text-2xl sm:text-3xl font-bold">
          Study <span className="gradient-text">Utilities Hub</span>
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Non-subject college To-Dos, quick Brainstorm scratchpad, and Pomodoro
          focus timer in one workspace
        </p>
      </motion.div>

      <Tabs defaultValue="todos">
        <TabsList>
          <TabsTrigger value="todos" className="gap-1.5">
            <CheckSquare className="h-4 w-4" />
            To-Do List ({todos.filter((t) => !t.isCompleted).length})
          </TabsTrigger>
          <TabsTrigger value="brainstorm" className="gap-1.5">
            <StickyNote className="h-4 w-4" />
            Brainstorm Pad ({scratchNotes.length})
          </TabsTrigger>
          <TabsTrigger value="pomodoro" className="gap-1.5">
            <Clock className="h-4 w-4" />
            Pomodoro Timer
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: TO-DO LIST */}
        <TabsContent value="todos" className="space-y-4">
          <Card className="p-4">
            <form
              onSubmit={addTodo}
              className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5"
            >
              <Input
                placeholder="Add a college/personal task (e.g., Pay exam fee, Collect ID card, Print lab manual)..."
                value={todoTitle}
                onChange={(e) => setTodoTitle(e.target.value)}
                className="flex-1"
              />
              <Select
                value={todoCat}
                onValueChange={(v) => setTodoCat(v as TodoItem["category"])}
              >
                <SelectTrigger className="w-full sm:w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="COLLEGE">College</SelectItem>
                  <SelectItem value="GENERAL">General</SelectItem>
                  <SelectItem value="ERRAND">Errand</SelectItem>
                  <SelectItem value="PERSONAL">Personal</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="date"
                value={todoDue}
                onChange={(e) => setTodoDue(e.target.value)}
                className="w-full sm:w-[155px]"
              />
              <Button type="submit" variant="glow">
                <Plus className="h-4 w-4" /> Add Task
              </Button>
            </form>
          </Card>

          <div className="flex items-center gap-2">
            {(
              [
                { id: "ALL", label: `All (${todos.length})` },
                {
                  id: "PENDING",
                  label: `Pending (${todos.filter((t) => !t.isCompleted).length})`,
                },
                {
                  id: "DONE",
                  label: `Done (${todos.filter((t) => t.isCompleted).length})`,
                },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                onClick={() => setTodoFilter(f.id)}
                className={cn(
                  "px-3 py-1 rounded-lg text-xs font-medium border cursor-pointer transition-colors",
                  todoFilter === f.id
                    ? "bg-primary/20 border-primary/50 text-primary"
                    : "border-glass-border text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="h-40 rounded-xl shimmer" />
          ) : visibleTodos.length === 0 ? (
            <Card className="p-10 text-center text-sm text-muted-foreground">
              No tasks here yet. Add quick college admin, club, or personal
              tasks above.
            </Card>
          ) : (
            <div className="space-y-2">
              {visibleTodos.map((item) => (
                <Card key={item.id} className="p-3.5">
                  <CardContent className="p-0 flex items-center justify-between gap-3">
                    <button
                      onClick={() => toggleTodo(item)}
                      className="flex items-center gap-3 text-left flex-1 min-w-0 cursor-pointer"
                    >
                      {item.isCompleted ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
                      ) : (
                        <Circle className="h-5 w-5 text-muted-foreground shrink-0" />
                      )}
                      <span
                        className={cn(
                          "text-sm font-medium break-words",
                          item.isCompleted &&
                            "line-through text-muted-foreground",
                        )}
                      >
                        {item.title}
                      </span>
                    </button>

                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className="text-[10px]">
                        {item.category}
                      </Badge>
                      {item.dueDate && (
                        <span className="text-xs text-muted-foreground">
                          {formatDate(item.dueDate)}
                        </span>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        onClick={() => deleteTodo(item.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* TAB 2: BRAINSTORM PAD */}
        <TabsContent value="brainstorm" className="space-y-6">
          {/* Full-width Spacious Editor on Top */}
          <Card className="p-5 sm:p-6 gradient-border space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <StickyNote className="h-4.5 w-4.5 text-primary" />
                <h3 className="font-semibold text-base">
                  {editingNoteId
                    ? "Edit Brainstorm Note"
                    : "Brainstorm & Rough Notes Canvas"}
                </h3>
              </div>
              <span className="text-xs text-muted-foreground">
                {noteContent.length} characters • Click any saved note card to pop it open
              </span>
            </div>

            <form onSubmit={saveScratchNote} className="space-y-4">
              <Input
                placeholder="Note Title (e.g., Hackathon architecture, Club event checklist, Physics formulas...)"
                value={noteTitle}
                onChange={(e) => setNoteTitle(e.target.value)}
                className="text-base font-medium"
                required
              />
              <Textarea
                rows={10}
                placeholder="Dump messy thoughts, rough drafts, meeting minutes, or code snippets here — then click AI Optimize to automatically fix grammar, structure headings, and clean spacing..."
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                className="min-h-[240px] leading-relaxed text-sm resize-y"
              />
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground mr-1">
                    Accent:
                  </span>
                  {NOTE_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNoteColor(c)}
                      className={cn(
                        "h-6 w-6 rounded-full border-2 cursor-pointer transition-transform",
                        noteColor === c
                          ? "border-white scale-110"
                          : "border-transparent hover:scale-105",
                      )}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  {editingNoteId && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditingNoteId(null);
                        setNoteTitle("");
                        setNoteContent("");
                        setNoteRawContent(null);
                      }}
                    >
                      Cancel Edit
                    </Button>
                  )}
                  {noteRawContent && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setNoteContent(noteRawContent);
                        setNoteRawContent(null);
                        toast.info("Restored original unedited text");
                      }}
                      title="Revert back to your raw unoptimized draft"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Restore Raw
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleOptimizeNote("canvas")}
                    disabled={optimizing || !noteContent.trim()}
                  >
                    {optimizing ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                        Optimizing...
                      </>
                    ) : (
                      <>
                        <Wand2 className="h-3.5 w-3.5 text-primary" />
                        AI Optimize
                      </>
                    )}
                  </Button>
                  <Button type="submit" variant="glow" size="sm">
                    <Save className="h-3.5 w-3.5" />{" "}
                    {editingNoteId ? "Update Note" : "Save Note"}
                  </Button>
                </div>
              </div>
            </form>
          </Card>

          {/* Saved Notes Grid Below */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-muted-foreground">
              Captured Notes ({scratchNotes.length})
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {scratchNotes.length === 0 ? (
                <Card className="md:col-span-2 lg:col-span-3 p-10 text-center text-sm text-muted-foreground">
                  No brainstorm notes yet. Write in the canvas above and hit
                  Save Note.
                </Card>
              ) : (
                scratchNotes.map((note) => (
                  <Card
                    key={note.id}
                    className="p-4 flex flex-col justify-between gap-3 hover:border-primary/50 hover:bg-muted/30 transition-all"
                    style={{ borderTop: `3px solid ${note.color}` }}
                  >
                    <div
                      onClick={() => openKeepNoteModal(note)}
                      className="space-y-2 cursor-pointer flex-1"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="font-semibold text-sm text-foreground leading-snug">
                          {note.title}
                        </h4>
                        <div className="flex items-center gap-1 shrink-0">
                          {note.rawContent && (
                            <Badge variant="outline" className="text-[10px]">
                              AI + Raw
                            </Badge>
                          )}
                          {note.pinned && (
                            <Pin className="h-3.5 w-3.5 text-primary" />
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-6">
                        {note.content || "Empty note"}
                      </p>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-glass-border/50">
                      <span className="text-[11px] text-muted-foreground">
                        {formatDate(note.updatedAt)}
                      </span>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => openKeepNoteModal(note)}
                          title="Open note"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => togglePin(note)}
                          title={note.pinned ? "Unpin" : "Pin to top"}
                        >
                          <Pin
                            className={cn(
                              "h-3.5 w-3.5",
                              note.pinned && "text-primary",
                            )}
                          />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          onClick={() => deleteScratchNote(note.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))
              )}
            </div>
          </div>

          {/* Google Keep–Style Popout Note Dialog */}
          <Dialog
            open={Boolean(viewingNote)}
            onOpenChange={(open) => !open && setViewingNote(null)}
          >
            <DialogContent
              className="max-w-2xl max-h-[88vh] overflow-y-auto"
              style={
                viewingNote
                  ? { borderTop: `4px solid ${modalEditing ? modalColor : viewingNote.color}` }
                  : undefined
              }
            >
              {viewingNote && (
                <>
                  <DialogHeader>
                    <div className="flex items-start justify-between gap-3 pr-6">
                      <div className="space-y-1 flex-1 min-w-0">
                        {modalEditing ? (
                          <Input
                            value={modalTitle}
                            onChange={(e) => setModalTitle(e.target.value)}
                            className="text-lg font-semibold"
                          />
                        ) : (
                          <DialogTitle className="text-xl break-words">
                            {viewingNote.title}
                          </DialogTitle>
                        )}
                        <DialogDescription className="flex items-center gap-2 text-xs">
                          <span>Updated {formatDate(viewingNote.updatedAt)}</span>
                          {viewingNote.rawContent && !modalEditing && (
                            <span className="inline-flex rounded-lg bg-muted p-0.5 ml-2">
                              <button
                                type="button"
                                onClick={() => setViewMode("OPTIMIZED")}
                                className={cn(
                                  "px-2 py-0.5 rounded-md text-[11px] font-medium cursor-pointer transition-colors",
                                  viewMode === "OPTIMIZED"
                                    ? "bg-primary text-white"
                                    : "text-muted-foreground hover:text-foreground",
                                )}
                              >
                                AI Formatted
                              </button>
                              <button
                                type="button"
                                onClick={() => setViewMode("RAW")}
                                className={cn(
                                  "px-2 py-0.5 rounded-md text-[11px] font-medium cursor-pointer transition-colors",
                                  viewMode === "RAW"
                                    ? "bg-primary text-white"
                                    : "text-muted-foreground hover:text-foreground",
                                )}
                              >
                                Original Raw
                              </button>
                            </span>
                          )}
                        </DialogDescription>
                      </div>
                    </div>
                  </DialogHeader>

                  {modalEditing ? (
                    <div className="space-y-4 py-2">
                      <Textarea
                        rows={12}
                        value={modalContent}
                        onChange={(e) => setModalContent(e.target.value)}
                        className="min-h-[260px] text-sm leading-relaxed"
                      />
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-1.5">
                          {NOTE_COLORS.map((c) => (
                            <button
                              key={c}
                              type="button"
                              onClick={() => setModalColor(c)}
                              className={cn(
                                "h-6 w-6 rounded-full border-2 cursor-pointer",
                                modalColor === c
                                  ? "border-white scale-110"
                                  : "border-transparent",
                              )}
                              style={{ backgroundColor: c }}
                            />
                          ))}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleOptimizeNote("modal")}
                            disabled={optimizing}
                          >
                            {optimizing ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Wand2 className="h-3.5 w-3.5 text-primary" />
                            )}
                            AI Optimize
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setModalEditing(false)}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="button"
                            variant="glow"
                            size="sm"
                            onClick={saveModalEdit}
                          >
                            <Save className="h-3.5 w-3.5" /> Save Changes
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="rounded-xl border border-glass-border bg-muted/35 p-4 sm:p-5 min-h-[160px]">
                        {viewMode === "RAW" && viewingNote.rawContent ? (
                          <pre className="whitespace-pre-wrap font-sans text-sm text-foreground/90 leading-relaxed">
                            {viewingNote.rawContent}
                          </pre>
                        ) : (
                          <MarkdownRenderer
                            content={viewingNote.content || "_Empty note_"}
                          />
                        )}
                      </div>

                      <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-glass-border/60">
                        <div className="flex items-center gap-1.5">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setModalEditing(true)}
                          >
                            <Edit2 className="h-3.5 w-3.5" /> Edit
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleOptimizeNote("modal")}
                            disabled={optimizing}
                          >
                            <Wand2 className="h-3.5 w-3.5 text-primary" />{" "}
                            {viewingNote.rawContent ? "Re-Optimize" : "AI Optimize"}
                          </Button>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={async () => {
                              const text =
                                viewMode === "RAW" && viewingNote.rawContent
                                  ? viewingNote.rawContent
                                  : viewingNote.content;
                              await navigator.clipboard.writeText(text);
                              toast.success("Copied note!");
                            }}
                          >
                            <Copy className="h-3.5 w-3.5" /> Copy
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => togglePin(viewingNote)}
                          >
                            <Pin
                              className={cn(
                                "h-3.5 w-3.5",
                                viewingNote.pinned && "text-primary",
                              )}
                            />
                            {viewingNote.pinned ? "Unpin" : "Pin"}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            onClick={() => deleteScratchNote(viewingNote.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Delete
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* TAB 3: POMODORO */}
        <TabsContent value="pomodoro">
          <PomodoroWidget />
        </TabsContent>
      </Tabs>
    </div>
  );
}
