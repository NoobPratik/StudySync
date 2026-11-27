"use client";

import { Suspense, useEffect, useState, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import {
  Bot,
  Send,
  Plus,
  Trash2,
  Loader2,
  Sparkles,
  FileText,
  User,
  Globe,
} from "lucide-react";
import { StudyHeroEmblem, OrbitalIllustration } from "@/components/ui/study-emblem";
import { AiDebugPanel } from "@/components/ui/ai-debug-panel";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { useElapsedSeconds } from "@/hooks/use-elapsed-timer";
import { readSseStream } from "@/lib/sse-client";
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

interface Thread {
  id: string;
  title: string;
  messages: Message[];
}

interface OpenedNote {
  id: string;
  title: string;
  fileName: string;
  subjectName: string | null;
}

interface WebSource {
  title: string;
  url: string;
}

const STARTER_PROMPTS = [
  "Based on my covered vs remaining topics, what should I study next?",
  "Teach me de Broglie wavelength and Heisenberg uncertainty with derivations and numericals.",
  "Quiz me with 5 university-level viva questions on my remaining syllabus.",
  "Help me prepare for my next upcoming deadline using my uploaded notes.",
];

function ChatWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [useWebSearch, setUseWebSearch] = useState(false);
  const [sending, setSending] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [streamingReply, setStreamingReply] = useState("");
  const [streamingThinking, setStreamingThinking] = useState("");
  const [debugModeActive, setDebugModeActive] = useState(false);
  const [debugModel, setDebugModel] = useState("");
  const [loading, setLoading] = useState(true);
  const [lastOpenedNotes, setLastOpenedNotes] = useState<OpenedNote[]>([]);
  const [lastWebSources, setLastWebSources] = useState<WebSource[]>([]);

  const elapsed = useElapsedSeconds(sending);
  const bottomRef = useRef<HTMLDivElement>(null);
  const autoTriggeredRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    const isAutoTopic = searchParams.get("auto") === "1";
    fetch("/api/ai/chat")
      .then(async (cRes) => {
        if (!active) return;
        if (cRes.ok) {
          const cJson = await cRes.json();
          const list: Thread[] = cJson.threads || [];
          setThreads(list);
          if (list.length > 0 && !isAutoTopic) setActiveThreadId(list[0].id);
        }
      })
      .catch(() => {
        if (active) toast.error("Failed to load chat");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [searchParams]);

  const activeThread = threads.find((t) => t.id === activeThreadId) || null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeThread?.messages.length, sending, streamingReply]);

  function startNewChat() {
    setActiveThreadId(null);
    setLastOpenedNotes([]);
    setLastWebSources([]);
  }

  async function deleteThread(id: string) {
    try {
      await fetch(`/api/ai/chat?threadId=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      setThreads((prev) => prev.filter((t) => t.id !== id));
      if (activeThreadId === id) setActiveThreadId(null);
      toast.success("Conversation deleted");
    } catch {
      toast.error("Failed to delete chat");
    }
  }

  const sendMessage = useCallback(
    async (text?: string, opts?: { forceNewThread?: boolean }) => {
      const content = (text ?? input).trim();
      if (!content || sending) return;

      const targetThreadId = opts?.forceNewThread ? null : activeThreadId;
      if (opts?.forceNewThread) {
        setActiveThreadId(null);
        setLastOpenedNotes([]);
        setLastWebSources([]);
      }

      setPendingPrompt(content);
      setStreamingReply("");
      setStreamingThinking("");
      setSending(true);
      if (!text) setInput("");

      try {
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadId: targetThreadId,
            message: content,
            useWebSearch,
            stream: true,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Failed to send message");
        }

        await readSseStream<
          {
            openedNotes?: OpenedNote[];
            webSources?: WebSource[];
            debugMode?: boolean;
            model?: string;
          },
          { thread: Thread; openedNotes?: OpenedNote[]; webSources?: WebSource[] }
        >(res, {
          onMeta: (meta) => {
            if (meta.openedNotes) setLastOpenedNotes(meta.openedNotes);
            if (meta.webSources) setLastWebSources(meta.webSources);
            if (meta.debugMode !== undefined) setDebugModeActive(meta.debugMode);
            if (meta.model) setDebugModel(meta.model);
          },
          onThinking: (txt) => {
            setStreamingThinking((prev) => prev + txt);
          },
          onToken: (tok) => {
            setStreamingReply((prev) => prev + tok);
          },
          onDone: (done) => {
            const updated = done.thread;
            if (updated) {
              setThreads((prev) => {
                const exists = prev.some((t) => t.id === updated.id);
                return exists
                  ? prev.map((t) => (t.id === updated.id ? updated : t))
                  : [updated, ...prev];
              });
              setActiveThreadId(updated.id);
            }
            if (done.openedNotes) setLastOpenedNotes(done.openedNotes);
            if (done.webSources) setLastWebSources(done.webSources);
          },
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "AI chat failed");
      } finally {
        setPendingPrompt(null);
        setStreamingReply("");
        setSending(false);
      }
    },
    [input, sending, activeThreadId, useWebSearch],
  );

  // Auto-explain topic when redirected from /progress
  useEffect(() => {
    const auto = searchParams.get("auto");
    const topic = searchParams.get("topic");
    const subject = searchParams.get("subject");
    const mod = searchParams.get("module");
    if (auto !== "1" || !topic) return;

    const sig = `${subject}|${mod}|${topic}`;
    if (autoTriggeredRef.current === sig) return;
    autoTriggeredRef.current = sig;

    const builtPrompt = `Explain the topic "${topic}" in detail${mod ? ` under ${mod}` : ""}${subject ? ` for ${subject}` : ""}. Use my uploaded notes if available, include clear core concepts, key formulas/code examples, and 2 likely exam questions with brief solutions.`;

    sendMessage(builtPrompt, { forceNewThread: true });
    router.replace("/chat");
  }, [searchParams, sendMessage, router]);

  return (
    <div className="space-y-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3"
      >
        <div>
          <StudyHeroEmblem icon={Bot} eyebrow="Autonomous Tutor" accentColor="violet" />
          <h1 className="text-2xl sm:text-3xl font-bold">
            AI <span className="gradient-text">Professor & Study Tutor</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Automatically detects your subject, checks your syllabus progress,
            and opens relevant uploaded notes
          </p>
        </div>
        <Button variant="glow" size="sm" onClick={startNewChat}>
          <Plus className="h-4 w-4" /> New Chat
        </Button>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5 min-h-[640px]">
        {/* Thread Sidebar */}
        <Card className="p-4 flex flex-col gap-3 lg:col-span-1">
          <div className="flex-1 flex flex-col min-h-0">
            <p className="text-xs font-medium text-muted-foreground mb-2">
              Conversations
            </p>
            <div className="space-y-1.5 overflow-y-auto flex-1 max-h-[460px]">
              {loading ? (
                <div className="h-24 rounded-lg shimmer" />
              ) : threads.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No conversations yet.
                </p>
              ) : (
                threads.map((t) => (
                  <div
                    key={t.id}
                    className={cn(
                      "flex items-center justify-between gap-1 rounded-lg px-2.5 py-2 text-xs transition-colors",
                      activeThreadId === t.id
                        ? "bg-primary/20 text-primary"
                        : "hover:bg-glass-hover text-muted-foreground",
                    )}
                  >
                    <button
                      onClick={() => {
                        setActiveThreadId(t.id);
                        setLastOpenedNotes([]);
                        setLastWebSources([]);
                      }}
                      className="truncate text-left flex-1 cursor-pointer"
                    >
                      {t.title}
                    </button>
                    <button
                      onClick={() => deleteThread(t.id)}
                      className="text-muted-foreground hover:text-destructive cursor-pointer shrink-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </Card>

        {/* Main Chat Area */}
        <Card className="lg:col-span-3 p-5 flex flex-col justify-between h-[660px]">
          <div className="flex-1 overflow-y-auto space-y-4 pr-2">
            {(!activeThread || activeThread.messages.length === 0) &&
            !pendingPrompt ? (
              <div className="h-full flex flex-col items-center justify-center text-center space-y-5 px-4">
                <OrbitalIllustration className="h-24 w-24 animate-float" />
                <div className="space-y-1.5 max-w-md">
                  <h3 className="text-lg font-semibold">
                    Ask your AI Professor anything
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Supports full Markdown tables, code blocks, and LaTeX math
                    equations — grounded in your uploaded notes and topic
                    checkpoints.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-w-xl w-full">
                  {STARTER_PROMPTS.map((p) => (
                    <button
                      key={p}
                      onClick={() => sendMessage(p)}
                      className="text-left text-xs rounded-xl border border-glass-border bg-muted/40 p-3 hover:border-primary/50 hover:bg-glass-hover transition-colors cursor-pointer"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-primary mb-1" />
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {(activeThread?.messages || []).map((m) => (
                  <div
                    key={m.id}
                    className={cn(
                      "flex items-start gap-3",
                      m.role === "user" ? "justify-end" : "justify-start",
                    )}
                  >
                    {m.role === "assistant" && (
                      <div className="h-8 w-8 rounded-lg bg-primary/20 flex items-center justify-center shrink-0 mt-1">
                        <Bot className="h-4 w-4 text-primary" />
                      </div>
                    )}
                    <div
                      className={cn(
                        "max-w-[85%] rounded-2xl px-4 py-3 text-sm",
                        m.role === "user"
                          ? "bg-primary text-white"
                          : "border border-glass-border bg-muted/55 text-foreground",
                      )}
                    >
                      {m.role === "user" ? (
                        <p className="whitespace-pre-wrap">{m.content}</p>
                      ) : (
                        <MarkdownRenderer content={m.content} />
                      )}
                    </div>
                    {m.role === "user" && (
                      <div className="h-8 w-8 rounded-lg bg-secondary/20 flex items-center justify-center shrink-0 mt-1">
                        <User className="h-4 w-4 text-secondary" />
                      </div>
                    )}
                  </div>
                ))}

                {(lastOpenedNotes.length > 0 || lastWebSources.length > 0) &&
                  !sending && (
                    <div className="pl-11 flex items-center gap-1.5 flex-wrap">
                      {lastOpenedNotes.map((n) => (
                        <Badge
                          key={n.id}
                          variant="outline"
                          className="text-[10px] gap-1"
                        >
                          <FileText className="h-2.5 w-2.5 text-primary" />
                          Opened: {n.title}
                        </Badge>
                      ))}
                      {lastWebSources.map((s, idx) => (
                        <a
                          key={idx}
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-md border border-glass-border px-2 py-0.5 text-[10px] text-accent hover:border-primary"
                        >
                          <Globe className="h-2.5 w-2.5" />
                          {s.title.slice(0, 36)}
                        </a>
                      ))}
                    </div>
                  )}

                {pendingPrompt && (
                  <>
                    <div className="flex items-start gap-3 justify-end">
                      <div className="max-w-[85%] rounded-2xl px-4 py-3 text-sm bg-primary text-white">
                        <p className="whitespace-pre-wrap">{pendingPrompt}</p>
                      </div>
                      <div className="h-8 w-8 rounded-lg bg-secondary/20 flex items-center justify-center shrink-0 mt-1">
                        <User className="h-4 w-4 text-secondary" />
                      </div>
                    </div>

                    <div className="flex items-start gap-3 justify-start">
                      <div className="h-8 w-8 rounded-lg bg-primary/20 flex items-center justify-center shrink-0 mt-1">
                        <Bot className="h-4 w-4 text-primary" />
                      </div>
                      <div className="w-full max-w-[85%] rounded-2xl border border-glass-border bg-muted/55 p-4 space-y-3">
                        <AiDebugPanel
                          active={debugModeActive}
                          loading={sending && !streamingReply}
                          elapsedSeconds={elapsed}
                          thinkingText={streamingThinking}
                          model={debugModel}
                        />
                        {streamingReply ? (
                          <MarkdownRenderer content={streamingReply} />
                        ) : (
                          <>
                            <div className="flex items-center gap-2 text-xs text-accent font-medium">
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                              <span>
                                Reviewing relevant notes & preparing response ({elapsed}s)
                              </span>
                            </div>
                            <div className="space-y-2">
                              <div className="h-3.5 w-11/12 rounded shimmer" />
                              <div className="h-3.5 w-4/5 rounded shimmer" />
                              <div className="h-3.5 w-3/5 rounded shimmer" />
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </>
                )}
                <div ref={bottomRef} />
              </>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage();
            }}
            className="pt-4 border-t border-glass-border/60 flex items-center gap-2 flex-wrap sm:flex-nowrap"
          >
            <button
              type="button"
              onClick={() => setUseWebSearch(!useWebSearch)}
              className={cn(
                "px-3 py-2 rounded-lg text-xs font-medium border inline-flex items-center gap-1.5 shrink-0 cursor-pointer transition-colors",
                useWebSearch
                  ? "bg-primary/20 border-primary text-primary"
                  : "border-glass-border text-muted-foreground hover:text-foreground",
              )}
              title="Toggle live web search grounding"
            >
              <Globe className="h-3.5 w-3.5" />
              Web {useWebSearch ? "On" : "Off"}
            </button>
            <Input
              placeholder="Ask about any subject, module, formula, code, or deadline..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={sending}
            />
            <Button
              type="submit"
              variant="glow"
              disabled={sending || !input.trim()}
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <div className="h-12 w-72 rounded-lg shimmer" />
          <div className="h-[620px] rounded-xl shimmer" />
        </div>
      }
    >
      <ChatWorkspace />
    </Suspense>
  );
}
