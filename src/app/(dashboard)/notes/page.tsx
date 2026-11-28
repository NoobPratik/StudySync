"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Upload,
  FileText,
  FileSpreadsheet,
  Image as ImageIcon,
  File,
  Search,
  Download,
  Trash2,
  ExternalLink,
  Plus,
  FolderPlus,
  Loader2,
  Edit2,
  Sparkles,
  LayoutGrid,
  List,
  Wand2,
  GripVertical,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
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
import { cn, formatDate, formatFileSize } from "@/lib/utils";
import { useElapsedSeconds } from "@/hooks/use-elapsed-timer";
import { StudyHeroEmblem } from "@/components/ui/study-emblem";
import { AiLogsButton } from "@/components/ui/ai-logs-dialog";
import {
  useBackgroundAi,
  useBackgroundExtraction,
} from "@/components/background-extraction-provider";

interface Subject {
  id: string;
  name: string;
  code: string | null;
  color: string;
}

interface NoteItem {
  id: string;
  title: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  uploadedAt: string;
  subjectId: string | null;
  subject: Subject | null;
}

interface QueuedFile {
  file: File;
  title: string;
  subjectId: string;
}

function getFileIcon(fileType: string, fileName: string) {
  const lower = `${fileType} ${fileName}`.toLowerCase();
  if (lower.includes("image") || /\.(png|jpg|jpeg|webp|gif)$/.test(lower)) {
    return ImageIcon;
  }
  if (lower.includes("presentation") || /\.(ppt|pptx)$/.test(lower)) {
    return FileSpreadsheet;
  }
  if (
    lower.includes("pdf") ||
    lower.includes("text") ||
    /\.(pdf|doc|docx|txt|md)$/.test(lower)
  ) {
    return FileText;
  }
  return File;
}

function sortAlphabetically(list: NoteItem[]): NoteItem[] {
  return [...list].sort((a, b) =>
    a.title.localeCompare(b.title, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

const SUBJECT_COLORS = [
  "#7C3AED",
  "#6366F1",
  "#EC4899",
  "#10B981",
  "#F59E0B",
  "#06B6D4",
  "#8B5CF6",
  "#14B8A6",
  "#F43F5E",
];

export default function NotesPage() {
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);

  const [viewMode, setViewMode] = useState<"KANBAN" | "LIST">("KANBAN");
  const [selectedSubject, setSelectedSubject] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [draggingFile, setDraggingFile] = useState(false);
  const [draggedNoteId, setDraggedNoteId] = useState<string | null>(null);
  const [dropTargetCol, setDropTargetCol] = useState<string | null>(null);

  // Bulk Upload modal
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<QueuedFile[]>([]);
  const [bulkSubjectId, setBulkSubjectId] = useState("NONE");
  const [autoExtractOnUpload, setAutoExtractOnUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0, stage: "" });

  // Edit note modal
  const [editingNote, setEditingNote] = useState<NoteItem | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editSubjectId, setEditSubjectId] = useState("NONE");

  // Bulk/Single New Subject modal
  const [subjectModalOpen, setSubjectModalOpen] = useState(false);
  const [bulkSubjectsInput, setBulkSubjectsInput] = useState("");
  const [creatingSubjects, setCreatingSubjects] = useState(false);

  // AI loading flags
  const { startBatchExtraction, startExtraction, isRunning: isExtractingAny } =
    useBackgroundExtraction();
  const { startAiTask } = useBackgroundAi();
  const [categorizing, setCategorizing] = useState(false);
  const aiElapsed = useElapsedSeconds(categorizing);

  const loadData = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (viewMode === "LIST" && selectedSubject !== "ALL") {
        params.set("subjectId", selectedSubject);
      }
      if (searchQuery.trim()) params.set("q", searchQuery.trim());

      const [nRes, sRes] = await Promise.all([
        fetch(`/api/notes?${params.toString()}`),
        fetch("/api/subjects"),
      ]);
      if (nRes.ok) {
        const nJson = await nRes.json();
        setNotes(sortAlphabetically(nJson.notes || []));
      }
      if (sRes.ok) {
        const sJson = await sRes.json();
        const subs: Subject[] = sJson.subjects || [];
        subs.sort((a, b) =>
          a.name.localeCompare(b.name, undefined, {
            numeric: true,
            sensitivity: "base",
          }),
        );
        setSubjects(subs);
      }
    } catch {
      toast.error("Failed to load notes");
    } finally {
      setLoading(false);
    }
  }, [viewMode, selectedSubject, searchQuery]);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams();
    if (viewMode === "LIST" && selectedSubject !== "ALL") {
      params.set("subjectId", selectedSubject);
    }
    if (searchQuery.trim()) params.set("q", searchQuery.trim());

    Promise.all([
      fetch(`/api/notes?${params.toString()}`),
      fetch("/api/subjects"),
    ])
      .then(async ([nRes, sRes]) => {
        if (!active) return;
        if (nRes.ok) {
          const nJson = await nRes.json();
          if (active) setNotes(sortAlphabetically(nJson.notes || []));
        }
        if (sRes.ok) {
          const sJson = await sRes.json();
          const subs: Subject[] = sJson.subjects || [];
          subs.sort((a, b) =>
            a.name.localeCompare(b.name, undefined, {
              numeric: true,
              sensitivity: "base",
            }),
          );
          if (active) setSubjects(subs);
        }
      })
      .catch(() => {
        if (active) toast.error("Failed to load notes");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [viewMode, selectedSubject, searchQuery]);

  function openUploadWithSubject(subjectId: string) {
    setBulkSubjectId(subjectId);
    fileInputRef.current?.click();
  }

  function handleFilesSelected(
    fileList: FileList | File[] | null | undefined,
    presetSubjectId?: string,
  ) {
    if (!fileList || fileList.length === 0) return;
    const defaultSub =
      presetSubjectId ??
      (bulkSubjectId !== "NONE"
        ? bulkSubjectId
        : selectedSubject !== "ALL" && selectedSubject !== "UNASSIGNED"
          ? selectedSubject
          : "NONE");

    const items: QueuedFile[] = Array.from(fileList).map((file) => ({
      file,
      title: file.name.replace(/\.[^/.]+$/, ""),
      subjectId: defaultSub,
    }));

    setBulkSubjectId(defaultSub);
    setUploadQueue(items);
    setUploadDialogOpen(true);
  }

  function applySubjectToAll(subId: string) {
    setBulkSubjectId(subId);
    setUploadQueue((prev) => prev.map((q) => ({ ...q, subjectId: subId })));
  }

  async function handleBulkUpload(e: React.FormEvent) {
    e.preventDefault();
    if (uploadQueue.length === 0) return;

    setUploading(true);
    setUploadProgress({
      done: 0,
      total: uploadQueue.length,
      stage: "Uploading & indexing...",
    });
    let succeeded = 0;
    const uploadedForExtraction: Array<{ id: string; subjectId: string; title: string }> = [];

    try {
      for (let i = 0; i < uploadQueue.length; i++) {
        const item = uploadQueue[i];
        const formData = new FormData();
        formData.append("file", item.file);
        formData.append("title", item.title.trim() || item.file.name);
        if (item.subjectId !== "NONE") {
          formData.append("subjectId", item.subjectId);
        }

        const res = await fetch("/api/notes", {
          method: "POST",
          body: formData,
        });

        if (res.ok) {
          succeeded++;
          const json = await res.json().catch(() => ({}));
          if (
            autoExtractOnUpload &&
            json.note?.id &&
            item.subjectId !== "NONE"
          ) {
            uploadedForExtraction.push({
              id: json.note.id,
              subjectId: item.subjectId,
              title: item.title.trim() || item.file.name,
            });
          }
        } else {
          const err = await res.json().catch(() => ({}));
          toast.error(`${item.file.name}: ${err.error || "Upload failed"}`);
        }
        setUploadProgress({
          done: i + 1,
          total: uploadQueue.length,
          stage: "Uploading & indexing...",
        });
      }

      if (uploadedForExtraction.length > 0) {
        const subjectMap = new Map(subjects.map((s) => [s.id, s.name]));
        const queueReqs = uploadedForExtraction.map((target) => ({
          noteId: target.id,
          noteTitle: target.title,
          subjectId: target.subjectId,
          subjectName: subjectMap.get(target.subjectId) || "Subject",
          replaceExisting: false,
        }));
        toast.success(
          `Uploaded ${succeeded} file(s)! Topic extraction queued in background.`,
        );
        setUploadDialogOpen(false);
        setUploadQueue([]);
        setBulkSubjectId("NONE");
        loadData();
        startBatchExtraction(queueReqs);
        return;
      } else if (succeeded > 0) {
        toast.success(
          `Uploaded & indexed ${succeeded}/${uploadQueue.length} file(s)!`,
        );
      }

      setUploadDialogOpen(false);
      setUploadQueue([]);
      setBulkSubjectId("NONE");
      loadData();
    } finally {
      setUploading(false);
    }
  }

  async function handleCreateSubjects(e: React.FormEvent) {
    e.preventDefault();
    const lines = bulkSubjectsInput
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return;

    setCreatingSubjects(true);
    try {
      const existingNames = new Set(subjects.map((s) => s.name.toLowerCase()));
      let created = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (existingNames.has(line.toLowerCase())) continue;
        const color =
          SUBJECT_COLORS[(subjects.length + i) % SUBJECT_COLORS.length];
        const res = await fetch("/api/subjects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: line, color }),
        });
        if (res.ok) created++;
      }
      toast.success(`Added ${created} subject column(s)`);
      setSubjectModalOpen(false);
      setBulkSubjectsInput("");
      loadData();
    } catch {
      toast.error("Failed to create subjects");
    } finally {
      setCreatingSubjects(false);
    }
  }

  async function moveNoteToSubject(
    noteId: string,
    targetSubjectId: string | null,
  ) {
    try {
      const res = await fetch(`/api/notes/${noteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectId: targetSubjectId }),
      });
      if (!res.ok) throw new Error();
      toast.success("Moved note");
      loadData();
    } catch {
      toast.error("Failed to move note");
    }
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingNote || !editTitle.trim()) return;
    try {
      const res = await fetch(`/api/notes/${editingNote.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editTitle.trim(),
          subjectId: editSubjectId === "NONE" ? null : editSubjectId,
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Note updated");
      setEditingNote(null);
      loadData();
    } catch {
      toast.error("Failed to update note");
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/notes/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Note deleted");
      loadData();
    } catch {
      toast.error("Failed to delete note");
    }
  }

  async function handleAiCategorize() {
    setCategorizing(true);
    try {
      await startAiTask({
        id: "notes-categorize",
        feature: "notes_categorize",
        title: "AI Notes Categorizer",
        subtitle: "Matching uncategorized notes to subjects...",
        actionLabel: "Open Notes",
        actionHref: "/notes",
        run: async (signal) => {
          const res = await fetch("/api/ai/notes/categorize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal,
            body: JSON.stringify({}),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || "Categorization failed");
          return json as { updatedCount: number };
        },
        onComplete: (json) => {
          toast.success(
            json.updatedCount > 0
              ? `AI categorized ${json.updatedCount} note(s) into subjects!`
              : "No uncategorized notes matched your subjects",
          );
          loadData();
        },
      });
    } finally {
      setCategorizing(false);
    }
  }

  function handleExtractTopics(note: NoteItem) {
    if (!note.subjectId) {
      toast.info(
        "Assign this note to a Subject column first, then extract topics.",
      );
      return;
    }
    startExtraction({
      noteId: note.id,
      noteTitle: note.title,
      subjectId: note.subjectId,
      subjectName: note.subject?.name || "Subject",
      replaceExisting: false,
    });
  }

  const unassignedNotes = useMemo(
    () => sortAlphabetically(notes.filter((n) => !n.subjectId)),
    [notes],
  );

  const subjectColumns = useMemo(
    () =>
      subjects.map((s) => ({
        id: s.id,
        name: s.name,
        code: s.code,
        color: s.color,
        items: sortAlphabetically(notes.filter((n) => n.subjectId === s.id)),
      })),
    [subjects, notes],
  );

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      >
        <div>
          <StudyHeroEmblem icon={FileText} eyebrow="Study Library" accentColor="violet" />
          <h1 className="text-2xl sm:text-3xl font-bold">
            Notes & <span className="gradient-text">Subject Kanban</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Bulk upload files, drop directly into Subject columns, and extract
            clean syllabus topics
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <AiLogsButton />
          <Button
            variant="outline"
            size="sm"
            onClick={handleAiCategorize}
            disabled={categorizing}
          >
            {categorizing ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            ) : (
              <Wand2 className="h-4 w-4 text-primary" />
            )}
            {categorizing
              ? `Categorizing (${aiElapsed}s)`
              : "AI Auto-Categorize"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSubjectModalOpen(true)}
          >
            <FolderPlus className="h-4 w-4" />
            Add Subjects
          </Button>
          <Button
            variant="glow"
            size="sm"
            onClick={() => {
              setBulkSubjectId("NONE");
              fileInputRef.current?.click();
            }}
          >
            <Upload className="h-4 w-4" />
            Bulk Upload
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              handleFilesSelected(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      </motion.div>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="inline-flex rounded-lg bg-muted p-1 gap-1">
            <button
              onClick={() => setViewMode("KANBAN")}
              className={cn(
                "px-3 py-1 rounded-md text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer transition-all",
                viewMode === "KANBAN"
                  ? "bg-primary text-white shadow"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <LayoutGrid className="h-3.5 w-3.5" /> Subject Board
            </button>
            <button
              onClick={() => setViewMode("LIST")}
              className={cn(
                "px-3 py-1 rounded-md text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer transition-all",
                viewMode === "LIST"
                  ? "bg-primary text-white shadow"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <List className="h-3.5 w-3.5" /> All Files
            </button>
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDraggingFile(true);
            }}
            onDragLeave={() => setDraggingFile(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDraggingFile(false);
              handleFilesSelected(e.dataTransfer.files);
            }}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "rounded-lg border border-dashed px-4 py-1.5 text-xs cursor-pointer transition-all inline-flex items-center gap-2",
              draggingFile
                ? "border-primary bg-primary/15 text-primary"
                : "border-glass-border text-muted-foreground hover:border-primary/40",
            )}
          >
            <Upload className="h-3.5 w-3.5 text-primary" />
            Drop multiple PDFs / PPTX / DOCX / TXT here (or onto any Subject column)
          </div>
        </div>

        <div className="relative w-full md:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search notes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-72 rounded-xl shimmer" />
          ))}
        </div>
      ) : viewMode === "KANBAN" ? (
        <div className="space-y-5">
          {/* Compact Top Inbox & Smart Drop Strip (never creates a ragged grid gap) */}
          <div
            onDragOver={(e) => {
              if (!draggedNoteId && !e.dataTransfer.types.includes("Files"))
                return;
              e.preventDefault();
              setDropTargetCol("NONE");
            }}
            onDragLeave={() => setDropTargetCol(null)}
            onDrop={(e) => {
              e.preventDefault();
              setDropTargetCol(null);
              if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                handleFilesSelected(e.dataTransfer.files, "NONE");
              } else if (draggedNoteId) {
                moveNoteToSubject(draggedNoteId, null);
                setDraggedNoteId(null);
              }
            }}
            className={cn(
              "studio-shell p-4 transition-all",
              dropTargetCol === "NONE" &&
                "border-primary bg-primary/10 glow-purple",
            )}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="h-2.5 w-2.5 rounded-full bg-zinc-400 shrink-0" />
                <h3 className="font-semibold text-sm text-foreground">
                  Inbox / Uncategorized
                </h3>
                <Badge variant="outline" className="text-[10px]">
                  {unassignedNotes.length}
                </Badge>
                {unassignedNotes.length === 0 && (
                  <span className="text-xs text-muted-foreground hidden sm:inline">
                    — Drag files here or drop directly onto any Subject vault below
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {unassignedNotes.length > 0 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={handleAiCategorize}
                    disabled={categorizing}
                  >
                    <Wand2 className="h-3 w-3 text-primary" />
                    {categorizing ? `Sorting (${aiElapsed}s)` : "Auto-Sort"}
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => openUploadWithSubject("NONE")}
                >
                  <Plus className="h-3.5 w-3.5" /> Add to Inbox
                </Button>
              </div>
            </div>

            {unassignedNotes.length > 0 && (
              <div className="mt-3 pt-3 border-t border-glass-border/50 flex flex-wrap gap-2">
                {unassignedNotes.map((note) => {
                  const Icon = getFileIcon(note.fileType, note.fileName);
                  return (
                    <div
                      key={note.id}
                      draggable
                      onDragStart={() => setDraggedNoteId(note.id)}
                      onDragEnd={() => {
                        setDraggedNoteId(null);
                        setDropTargetCol(null);
                      }}
                      className="inline-flex items-center gap-2 rounded-xl border border-glass-border/80 bg-muted/45 px-3 py-1.5 text-xs cursor-grab active:cursor-grabbing hover:border-primary/45 transition-colors max-w-full"
                    >
                      <GripVertical className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                      <Icon className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span className="font-medium truncate max-w-[180px]">
                        {note.title}
                      </span>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {formatFileSize(note.fileSize)}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingNote(note);
                          setEditTitle(note.title);
                          setEditSubjectId("NONE");
                        }}
                        className="text-muted-foreground hover:text-foreground cursor-pointer p-0.5"
                        title="Assign subject"
                      >
                        <Edit2 className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(note.id)}
                        className="text-muted-foreground hover:text-destructive cursor-pointer p-0.5"
                        title="Delete"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Uniform Symmetrical Subject Vault Grid */}
          {subjectColumns.length === 0 ? (
            <Card className="p-10 text-center space-y-3">
              <FolderPlus className="h-9 w-9 text-muted-foreground mx-auto" />
              <div className="space-y-1">
                <h3 className="text-base font-semibold">No subject vaults yet</h3>
                <p className="text-xs text-muted-foreground">
                  Add your semester subjects to organize PDFs and extract chronological module topics.
                </p>
              </div>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 items-stretch">
              {subjectColumns.map((col) => (
                <div
                  key={col.id}
                  onDragOver={(e) => {
                    if (!draggedNoteId && !e.dataTransfer.types.includes("Files"))
                      return;
                    e.preventDefault();
                    setDropTargetCol(col.id);
                  }}
                  onDragLeave={() => setDropTargetCol(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDropTargetCol(null);
                    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                      handleFilesSelected(e.dataTransfer.files, col.id);
                    } else if (draggedNoteId) {
                      moveNoteToSubject(draggedNoteId, col.id);
                      setDraggedNoteId(null);
                    }
                  }}
                  className={cn(
                    "studio-shell flex flex-col h-[370px] transition-all",
                    dropTargetCol === col.id &&
                      "border-primary bg-primary/10 glow-purple",
                  )}
                >
                  {/* Colored Top Header Strip */}
                  <div
                    className="px-4 py-3 border-b border-glass-border/60 flex items-center justify-between gap-2 shrink-0"
                    style={{
                      background: `linear-gradient(90deg, ${col.color}18 0%, transparent 80%)`,
                    }}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className="h-3 w-3 rounded-full shrink-0 shadow-sm"
                        style={{ backgroundColor: col.color }}
                      />
                      <h3 className="font-semibold text-sm truncate text-foreground">
                        {col.name}
                      </h3>
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        {col.items.length}
                      </Badge>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      onClick={() => openUploadWithSubject(col.id)}
                      title={`Upload to ${col.name}`}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* Fixed-Height Scrollable Notes List */}
                  <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5 min-h-0">
                    {col.items.length === 0 ? (
                      <button
                        type="button"
                        onClick={() => openUploadWithSubject(col.id)}
                        className="w-full h-full min-h-[200px] rounded-xl border border-dashed border-glass-border/60 p-5 flex flex-col items-center justify-center text-center text-xs text-muted-foreground hover:border-primary/45 hover:text-foreground transition-colors cursor-pointer gap-2"
                      >
                        <Upload className="h-5 w-5 text-primary/70" />
                        <span>Drop PDFs / notes here or click to upload</span>
                      </button>
                    ) : (
                      col.items.map((note) => {
                        const Icon = getFileIcon(note.fileType, note.fileName);
                        const canPreview =
                          note.fileType.includes("pdf") ||
                          note.fileType.includes("image") ||
                          note.fileType.includes("text");

                        return (
                          <div
                            key={note.id}
                            draggable
                            onDragStart={() => setDraggedNoteId(note.id)}
                            onDragEnd={() => {
                              setDraggedNoteId(null);
                              setDropTargetCol(null);
                            }}
                            className="rounded-xl border border-glass-border/70 bg-muted/40 p-3 space-y-2 hover:border-primary/40 transition-colors cursor-grab active:cursor-grabbing"
                          >
                            <div className="flex items-start gap-2.5 min-w-0">
                              <GripVertical className="h-4 w-4 text-muted-foreground/60 mt-0.5 shrink-0" />
                              <Icon className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-foreground truncate">
                                  {note.title}
                                </p>
                                <p className="text-[11px] text-muted-foreground truncate">
                                  {formatFileSize(note.fileSize)} •{" "}
                                  {formatDate(note.uploadedAt)}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center justify-between pt-1.5 border-t border-glass-border/40">
                              <button
                                onClick={() => handleExtractTopics(note)}
                                disabled={isExtractingAny}
                                className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:text-primary transition-colors cursor-pointer disabled:opacity-50"
                                title="AI: Extract Modules & Topics into Progress Tracker"
                              >
                                <Sparkles className="h-3 w-3" />
                                Extract Topics
                              </button>

                              <div className="flex items-center gap-0.5">
                                {canPreview && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    asChild
                                  >
                                    <a
                                      href={`/api/notes/${note.id}/download?inline=1`}
                                      target="_blank"
                                      rel="noreferrer"
                                      title="Preview"
                                    >
                                      <ExternalLink className="h-3.5 w-3.5" />
                                    </a>
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  asChild
                                >
                                  <a
                                    href={`/api/notes/${note.id}/download`}
                                    title="Download"
                                  >
                                    <Download className="h-3.5 w-3.5" />
                                  </a>
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => {
                                    setEditingNote(note);
                                    setEditTitle(note.title);
                                    setEditSubjectId(note.subjectId || "NONE");
                                  }}
                                  title="Rename / Move"
                                >
                                  <Edit2 className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-destructive hover:text-destructive"
                                  onClick={() => handleDelete(note.id)}
                                  title="Delete"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Subtle Footer Strip */}
                  <div className="px-4 py-2 border-t border-glass-border/45 bg-muted/15 flex items-center justify-between text-[11px] text-muted-foreground shrink-0">
                    <span className="truncate">
                      {col.code ? col.code : "Drop PDFs to upload"}
                    </span>
                    <button
                      type="button"
                      onClick={() => openUploadWithSubject(col.id)}
                      className="text-accent hover:text-primary cursor-pointer font-medium"
                    >
                      + Upload
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setSelectedSubject("ALL")}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium border cursor-pointer",
                selectedSubject === "ALL"
                  ? "bg-primary/20 border-primary/50 text-primary"
                  : "border-glass-border text-muted-foreground",
              )}
            >
              All Files
            </button>
            <button
              onClick={() => setSelectedSubject("UNASSIGNED")}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium border cursor-pointer",
                selectedSubject === "UNASSIGNED"
                  ? "bg-primary/20 border-primary/50 text-primary"
                  : "border-glass-border text-muted-foreground",
              )}
            >
              Uncategorized
            </button>
            {subjects.map((sub) => (
              <button
                key={sub.id}
                onClick={() => setSelectedSubject(sub.id)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-medium border cursor-pointer inline-flex items-center gap-1.5",
                  selectedSubject === sub.id
                    ? "bg-primary/20 border-primary/50 text-primary"
                    : "border-glass-border text-muted-foreground",
                )}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: sub.color }}
                />
                {sub.name}
              </button>
            ))}
          </div>

          {notes.length === 0 ? (
            <Card className="p-12 text-center space-y-3">
              <FileText className="h-10 w-10 text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground">
                No notes match your filter.
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {notes.map((note) => {
                const Icon = getFileIcon(note.fileType, note.fileName);
                return (
                  <Card key={note.id} className="p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                        <Icon className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm truncate">
                          {note.title}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {formatFileSize(note.fileSize)} •{" "}
                          {note.subject?.name || "Uncategorized"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-glass-border/60">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs text-accent h-7 px-2"
                        onClick={() => handleExtractTopics(note)}
                        disabled={isExtractingAny}
                      >
                        <Sparkles className="h-3 w-3" />
                        Extract Topics
                      </Button>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                          <a href={`/api/notes/${note.id}/download`}>
                            <Download className="h-3.5 w-3.5" />
                          </a>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          onClick={() => handleDelete(note.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Bulk Upload Queue Dialog */}
      <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
        <DialogContent className="max-w-xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Bulk Upload Notes ({uploadQueue.length} file
              {uploadQueue.length === 1 ? "" : "s"})
            </DialogTitle>
            <DialogDescription>
              Edit titles or assign subjects before uploading. Text is
              automatically extracted for AI search and topic parsing.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleBulkUpload} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Apply Subject to All Files
              </Label>
              <Select value={bulkSubjectId} onValueChange={applySubjectToAll}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">
                    Inbox / Uncategorized (AI can sort later)
                  </SelectItem>
                  {subjects.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.code ? `${s.code} — ${s.name}` : s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2.5 max-h-[280px] overflow-y-auto pr-1">
              {uploadQueue.map((item, idx) => (
                <div
                  key={`${item.file.name}-${idx}`}
                  className="rounded-xl border border-glass-border bg-muted/40 p-3 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground truncate">
                      {item.file.name} ({formatFileSize(item.file.size)})
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setUploadQueue((prev) =>
                          prev.filter((_, i) => i !== idx),
                        )
                      }
                      className="text-muted-foreground hover:text-destructive cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Input
                      value={item.title}
                      onChange={(e) =>
                        setUploadQueue((prev) =>
                          prev.map((q, i) =>
                            i === idx ? { ...q, title: e.target.value } : q,
                          ),
                        )
                      }
                      placeholder="Note title"
                    />
                    <Select
                      value={item.subjectId}
                      onValueChange={(val) =>
                        setUploadQueue((prev) =>
                          prev.map((q, i) =>
                            i === idx ? { ...q, subjectId: val } : q,
                          ),
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NONE">Uncategorized</SelectItem>
                        {subjects.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-glass-border bg-muted/35 p-3 flex items-start gap-2.5">
              <input
                id="auto-extract-upload"
                type="checkbox"
                checked={autoExtractOnUpload}
                onChange={(e) => setAutoExtractOnUpload(e.target.checked)}
                className="mt-0.5 rounded border-glass-border accent-primary cursor-pointer"
              />
              <label
                htmlFor="auto-extract-upload"
                className="text-xs leading-snug cursor-pointer"
              >
                <span className="font-medium text-foreground inline-flex items-center gap-1">
                  <Sparkles className="h-3 w-3 text-primary" />
                  Auto-extract modules & core topics after upload
                </span>
                <span className="block text-muted-foreground mt-0.5">
                  Uses your fast AI model to build concise module milestones on
                  Progress for every file assigned to a subject.
                </span>
              </label>
            </div>

            {uploading && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span className="truncate">
                    {uploadProgress.stage || "Uploading & extracting text..."}
                  </span>
                  <span>
                    {uploadProgress.done}/{uploadProgress.total}
                  </span>
                </div>
                <Progress
                  value={
                    uploadProgress.total > 0
                      ? Math.round(
                          (uploadProgress.done / uploadProgress.total) * 100,
                        )
                      : 0
                  }
                />
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setUploadDialogOpen(false)}
                disabled={uploading}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="glow"
                disabled={uploading || uploadQueue.length === 0}
              >
                {uploading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Uploading (
                    {uploadProgress.done}/{uploadProgress.total})
                  </>
                ) : (
                  `Upload ${uploadQueue.length} File${uploadQueue.length === 1 ? "" : "s"}`
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Note Dialog */}
      <Dialog
        open={Boolean(editingNote)}
        onOpenChange={(open) => !open && setEditingNote(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Note Details</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSaveEdit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-note-title">Title</Label>
              <Input
                id="edit-note-title"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Subject Column</Label>
              <Select value={editSubjectId} onValueChange={setEditSubjectId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Inbox / Uncategorized</SelectItem>
                  {subjects.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.code ? `${s.code} — ${s.name}` : s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditingNote(null)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="glow">
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Bulk / Single Add Subjects Modal */}
      <Dialog open={subjectModalOpen} onOpenChange={setSubjectModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Subject Columns</DialogTitle>
            <DialogDescription>
              Enter one subject per line to create Kanban columns instantly.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateSubjects} className="space-y-4">
            <Textarea
              rows={7}
              placeholder={
                "Chemistry Lab\nCPPS Lab\nCTS\nEngineering Chemistry\nEngineering Graphics & Generative Design\nEnvironmental Science\nHuman Centered Design\nIntro to C Programming\nLinear Algebra and Data Foundations"
              }
              value={bulkSubjectsInput}
              onChange={(e) => setBulkSubjectsInput(e.target.value)}
              required
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setSubjectModalOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="glow" disabled={creatingSubjects}>
                {creatingSubjects ? "Creating..." : "Create Subjects"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
