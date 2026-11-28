"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Terminal, Loader2 } from "lucide-react";

interface AiDebugPanelProps {
  active: boolean;
  loading: boolean;
  elapsedSeconds: number;
  thinkingText: string;
  promptText?: string;
  outputText?: string;
  errorText?: string | null;
  model?: string;
  extraLabel?: string;
  defaultOpen?: boolean;
}

export function AiDebugPanel({
  active,
  loading,
  elapsedSeconds,
  thinkingText,
  promptText,
  outputText,
  errorText,
  model,
  extraLabel,
  defaultOpen = true,
}: AiDebugPanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [showPrompt, setShowPrompt] = useState(false);

  if (!active) return null;
  if (!loading && !thinkingText && !outputText && !errorText && !promptText) {
    return null;
  }

  return (
    <div className="rounded-xl border border-primary/35 bg-black/45 p-3 space-y-2 text-xs">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-2 text-left cursor-pointer"
      >
        <div className="flex items-center gap-2 font-medium text-accent min-w-0">
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
          )}
          <Terminal className="h-3.5 w-3.5 text-primary shrink-0" />
          {loading && <Loader2 className="h-3 w-3 animate-spin shrink-0" />}
          <span className="truncate">
            AI Debug Trace{model ? ` • ${model}` : ""}
            {extraLabel ? ` (${extraLabel})` : ""}
          </span>
        </div>
        <span className="text-[11px] font-mono text-muted-foreground shrink-0">
          {loading ? `${elapsedSeconds}s` : `${thinkingText.length} thinking chars`}
        </span>
      </button>

      {open && (
        <div className="space-y-2 pt-1">
          {errorText && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive">
              {errorText}
            </div>
          )}

          {promptText && (
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => setShowPrompt((v) => !v)}
                className="text-[10px] uppercase tracking-wider text-accent hover:text-primary inline-flex items-center gap-1 cursor-pointer"
              >
                {showPrompt ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                Input Prompt Sent ({promptText.length} chars)
              </button>
              {showPrompt && (
                <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap text-[11px] font-mono text-muted-foreground bg-muted/30 rounded-lg p-2.5 border border-glass-border/40">
                  {promptText}
                </pre>
              )}
            </div>
          )}

          {thinkingText ? (
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Thinking Stream ({thinkingText.length} chars)
              </p>
              <pre className="max-h-36 overflow-y-auto whitespace-pre-wrap text-[11px] font-mono text-muted-foreground bg-muted/30 rounded-lg p-2.5 border border-glass-border/40">
                {thinkingText}
              </pre>
            </div>
          ) : (
            loading && (
              <p className="text-[11px] text-muted-foreground font-mono">
                Waiting for reasoning/thinking tokens from model... ({elapsedSeconds}s)
              </p>
            )
          )}

          {outputText && (
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Raw Output Stream ({outputText.length} chars)
              </p>
              <pre className="max-h-28 overflow-y-auto whitespace-pre-wrap text-[11px] font-mono text-foreground/85 bg-muted/30 rounded-lg p-2.5 border border-glass-border/40">
                {outputText}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
