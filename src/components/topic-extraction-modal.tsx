"use client";

import { useState, useEffect } from "react";
import { Wand2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useBackgroundExtraction } from "@/components/background-extraction-provider";
import { cn } from "@/lib/utils";

export interface ExtractableNote {
  id: string;
  title: string;
  fileName: string;
}

export function TopicExtractionModal({
  open,
  onOpenChange,
  subjectId,
  subjectName,
  notes,
  initialNoteId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subjectId: string;
  subjectName: string;
  notes: ExtractableNote[];
  initialNoteId?: string;
}) {
  const { startExtraction, isRunning } = useBackgroundExtraction();
  const [selectedNoteId, setSelectedNoteId] = useState(
    initialNoteId || notes[0]?.id || "",
  );
  const [replaceExisting, setReplaceExisting] = useState(false);

  useEffect(() => {
    if (!open) return;
    const nextId = initialNoteId || notes[0]?.id || "";
    const t = setTimeout(() => {
      setSelectedNoteId(nextId);
      setReplaceExisting(false);
    }, 0);
    return () => clearTimeout(t);
  }, [open, initialNoteId, notes]);

  function handleStart(e: React.FormEvent) {
    e.preventDefault();
    const note = notes.find((n) => n.id === selectedNoteId);
    if (!note) return;

    startExtraction({
      noteId: note.id,
      noteTitle: note.title,
      subjectId,
      subjectName,
      replaceExisting,
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-lg bg-[#0d0d1f]/98">
        <DialogHeader className="pr-8">
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-primary" />
            Extract Chronological Topics
          </DialogTitle>
          <DialogDescription>
            Runs in the background for{" "}
            <span className="font-medium text-foreground">{subjectName}</span>{" "}
            so you can keep browsing while topics and page ranges are extracted.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleStart} className="space-y-4">
          <div className="space-y-2">
            <Label>Choose Uploaded Note / PDF</Label>
            <div className="space-y-1.5 max-h-52 overflow-y-auto">
              {notes.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => setSelectedNoteId(n.id)}
                  className={cn(
                    "w-full flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-xs transition-colors cursor-pointer",
                    selectedNoteId === n.id
                      ? "bg-primary/15 border-primary/50 text-foreground"
                      : "border-glass-border hover:bg-glass-hover text-muted-foreground",
                  )}
                >
                  <FileText className="h-3.5 w-3.5 text-primary shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{n.title}</p>
                    <p className="text-[10px] opacity-75 truncate">
                      {n.fileName}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-start gap-2.5 rounded-lg border border-glass-border bg-muted/30 p-3 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={replaceExisting}
              onChange={(e) => setReplaceExisting(e.target.checked)}
              className="mt-0.5 accent-primary"
            />
            <div>
              <span className="font-medium text-foreground block">
                Rebuild matched module in strict PDF order
              </span>
              <span className="text-muted-foreground">
                Replaces old disordered topics with fresh chronological order
                and exact page ranges (preserves checkmarks on matching names).
              </span>
            </div>
          </label>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="glow"
              disabled={!selectedNoteId || isRunning}
            >
              <Wand2 className="h-4 w-4" />
              {isRunning ? "Extraction Running..." : "Extract in Background"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
