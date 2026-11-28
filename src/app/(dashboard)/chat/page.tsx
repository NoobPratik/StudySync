"use client";

import {
  Suspense,
  useEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
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
  Maximize2,
  Minimize2,
  CheckCircle2,
  Circle,
  Brain,
  ClipboardList,
  ArrowRight,
  RotateCcw,
  PanelLeft,
  X,
  BookOpen,
  Layers,
  ChevronRight,
  Square,
} from "lucide-react";
import { AiDebugPanel } from "@/components/ui/ai-debug-panel";
import { AiLogsButton } from "@/components/ui/ai-logs-dialog";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { useElapsedSeconds } from "@/hooks/use-elapsed-timer";
import { readSseStream } from "@/lib/sse-client";
import { cn } from "@/lib/utils";

interface TopicItem {
  id: string;
  name: string;
  isCompleted: boolean;
  order: number;
}

interface ModuleItem {
  id: string;
  name: string;
  order: number;
  topics: TopicItem[];
}

interface SubjectItem {
  id: string;
  name: string;
  code: string | null;
  color: string;
  modules: ModuleItem[];
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

interface MessageMetadata {
  action?: string;
  subjectId?: string | null;
  subjectName?: string | null;
  moduleId?: string | null;
  moduleName?: string | null;
  topicId?: string | null;
  topicName?: string | null;
  openedNotes?: OpenedNote[];
  webSources?: WebSource[];
  model?: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  metadata?: string | null;
  createdAt: string;
}

interface Thread {
  id: string;
  title: string;
  subjectId: string | null;
  moduleId: string | null;
  topicId: string | null;
  mode: string;
  subject?: { id: string; name: string; code: string | null; color: string } | null;
  module?: { id: string; name: string; topics: TopicItem[] } | null;
  topic?: { id: string; name: string; isCompleted: boolean; order: number } | null;
  messages: Message[];
}

type TutorAction = "chat" | "explain" | "quiz" | "mock" | "regenerate";

function parseMeta(raw?: string | null): MessageMetadata {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as MessageMetadata;
  } catch {
    return {};
  }
}

function ChatWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [subjects, setSubjects] = useState<SubjectItem[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);

  const [selectedSubjectId, setSelectedSubjectId] = useState<string>("AUTO");
  const [selectedModuleId, setSelectedModuleId] = useState<string>("NONE");
  const [selectedTopicId, setSelectedTopicId] = useState<string>("NONE");

  const [input, setInput] = useState("");
  const [useWebSearch, setUseWebSearch] = useState(false);
  const [useThinking, setUseThinking] = useState(false);
  const [sending, setSending] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [streamingReply, setStreamingReply] = useState("");
  const [streamingThinking, setStreamingThinking] = useState("");
  const [streamingPrompt, setStreamingPrompt] = useState("");
  const [debugModeActive, setDebugModeActive] = useState(false);
  const [debugModel, setDebugModel] = useState("");
  const [loading, setLoading] = useState(true);

  const [lastOpenedNotes, setLastOpenedNotes] = useState<OpenedNote[]>([]);
  const [lastWebSources, setLastWebSources] = useState<WebSource[]>([]);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<"ROADMAP" | "CHATS">("ROADMAP");

  const elapsed = useElapsedSeconds(sending);
  const bottomRef = useRef<HTMLDivElement>(null);
  const autoTriggeredRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const stopGeneration = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }, []);

  useEffect(() => {
    let active = true;
    const isStudyLaunch =
      searchParams.get("study") === "1" || searchParams.get("auto") === "1";

    Promise.all([fetch("/api/ai/chat"), fetch("/api/subjects")])
      .then(async ([cRes, sRes]) => {
        if (!active) return;
        let loadedSubjects: SubjectItem[] = [];
        if (sRes.ok) {
          const sJson = await sRes.json();
          loadedSubjects = sJson.subjects || [];
          setSubjects(loadedSubjects);
        }
        if (cRes.ok) {
          const cJson = await cRes.json();
          const list: Thread[] = cJson.threads || [];
          setThreads(list);
          if (list.length > 0 && !isStudyLaunch) {
            const first = list[0];
            setActiveThreadId(first.id);
            if (first.subjectId) setSelectedSubjectId(first.subjectId);
            if (first.moduleId) setSelectedModuleId(first.moduleId);
            if (first.topicId) setSelectedTopicId(first.topicId);
            if (first.moduleId) setSidebarTab("ROADMAP");
            else setSidebarTab("CHATS");
          } else if (loadedSubjects.length === 1 && !isStudyLaunch) {
            setSelectedSubjectId(loadedSubjects[0].id);
          }
        }
      })
      .catch(() => {
        if (active) toast.error("Failed to load study chat");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [searchParams]);

  // Lock body scroll when fullscreen is active
  useEffect(() => {
    if (!isFullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [isFullscreen]);

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId) || null,
    [threads, activeThreadId],
  );

  const selectedSubject = useMemo(
    () =>
      selectedSubjectId !== "AUTO"
        ? subjects.find((s) => s.id === selectedSubjectId) || null
        : null,
    [subjects, selectedSubjectId],
  );

  const selectedModule = useMemo(
    () =>
      selectedSubject && selectedModuleId !== "NONE"
        ? selectedSubject.modules.find((m) => m.id === selectedModuleId) || null
        : null,
    [selectedSubject, selectedModuleId],
  );

  const selectedTopic = useMemo(
    () =>
      selectedModule && selectedTopicId !== "NONE"
        ? selectedModule.topics.find((t) => t.id === selectedTopicId) || null
        : null,
    [selectedModule, selectedTopicId],
  );

  const activeTopicIndex = useMemo(() => {
    if (!selectedModule || !selectedTopic) return -1;
    return selectedModule.topics.findIndex((t) => t.id === selectedTopic.id);
  }, [selectedModule, selectedTopic]);

  const nextTopicInModule = useMemo(() => {
    if (!selectedModule || activeTopicIndex === -1) return null;
    if (activeTopicIndex + 1 < selectedModule.topics.length) {
      return selectedModule.topics[activeTopicIndex + 1];
    }
    return null;
  }, [selectedModule, activeTopicIndex]);

  const nextUncompletedTopic = useMemo(() => {
    if (!selectedModule) return null;
    if (activeTopicIndex !== -1) {
      const after = selectedModule.topics
        .slice(activeTopicIndex + 1)
        .find((t) => !t.isCompleted);
      if (after) return after;
    }
    return selectedModule.topics.find(
      (t) => !t.isCompleted && t.id !== selectedTopic?.id,
    ) || nextTopicInModule;
  }, [selectedModule, activeTopicIndex, selectedTopic, nextTopicInModule]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeThread?.messages.length, sending, streamingReply]);

  const sendTutorRequest = useCallback(
    async (opts: {
      action: TutorAction;
      message?: string;
      subjectId?: string | null;
      moduleId?: string | null;
      topicId?: string | null;
      forceNewThread?: boolean;
      displayLabel?: string;
    }) => {
      if (sending) return;

      const resolvedSub =
        opts.subjectId !== undefined
          ? opts.subjectId
          : selectedSubjectId !== "AUTO"
            ? selectedSubjectId
            : null;
      const resolvedMod =
        opts.moduleId !== undefined
          ? opts.moduleId
          : selectedModuleId !== "NONE"
            ? selectedModuleId
            : null;
      const resolvedTop =
        opts.topicId !== undefined
          ? opts.topicId
          : selectedTopicId !== "NONE"
            ? selectedTopicId
            : null;

      const content = (opts.message ?? input).trim();
      if (opts.action === "chat" && !content) return;

      const targetThreadId = opts.forceNewThread ? null : activeThreadId;
      if (opts.forceNewThread) {
        setActiveThreadId(null);
      }

      const pendingLabel =
        opts.displayLabel ||
        (opts.action === "explain"
          ? "Explaining topic from your course notes..."
          : opts.action === "regenerate"
            ? "Regenerating explanation..."
            : opts.action === "quiz"
              ? "Preparing check-for-understanding quiz..."
              : opts.action === "mock"
                ? "Generating exam mock questions..."
                : content);

      setPendingPrompt(pendingLabel);
      setStreamingReply("");
      setStreamingThinking("");
      setStreamingPrompt("");
      setLastOpenedNotes([]);
      setLastWebSources([]);
      setSending(true);
      if (opts.action === "chat" && !opts.message) setInput("");

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            threadId: targetThreadId,
            subjectId: resolvedSub,
            moduleId: resolvedMod,
            topicId: resolvedTop,
            action: opts.action,
            message: content,
            useWebSearch,
            think: useThinking,
            stream: true,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Failed to reach tutor");
        }

        await readSseStream<
          {
            subject?: { id: string } | null;
            module?: { id: string } | null;
            topic?: { id: string } | null;
            openedNotes?: OpenedNote[];
            webSources?: WebSource[];
            debugMode?: boolean;
            model?: string;
            promptPreview?: string;
          },
          {
            thread: Thread;
            openedNotes?: OpenedNote[];
            webSources?: WebSource[];
          }
        >(res, {
          onMeta: (meta) => {
            if (meta.openedNotes) setLastOpenedNotes(meta.openedNotes);
            if (meta.webSources) setLastWebSources(meta.webSources);
            if (meta.debugMode !== undefined) setDebugModeActive(meta.debugMode);
            if (meta.model) setDebugModel(meta.model);
            if (meta.promptPreview) setStreamingPrompt(meta.promptPreview);
            if (meta.subject?.id) setSelectedSubjectId(meta.subject.id);
            if (meta.module?.id) setSelectedModuleId(meta.module.id);
            if (meta.topic?.id) setSelectedTopicId(meta.topic.id);
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
              if (updated.subjectId) setSelectedSubjectId(updated.subjectId);
              if (updated.moduleId) setSelectedModuleId(updated.moduleId);
              if (updated.topicId) setSelectedTopicId(updated.topicId);
            }
            if (done.openedNotes) setLastOpenedNotes(done.openedNotes);
            if (done.webSources) setLastWebSources(done.webSources);
          },
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          toast.info("Generation stopped");
        } else {
          toast.error(err instanceof Error ? err.message : "Tutor request failed");
        }
      } finally {
        abortControllerRef.current = null;
        setPendingPrompt(null);
        setStreamingReply("");
        setSending(false);
      }
    },
    [
      sending,
      selectedSubjectId,
      selectedModuleId,
      selectedTopicId,
      input,
      activeThreadId,
      useWebSearch,
      useThinking,
    ],
  );

  // Handle incoming ?study=1&subjectId=...&moduleId=...&topicId=... from /progress
  useEffect(() => {
    if (loading) return;
    const isStudy = searchParams.get("study") === "1";
    const sId = searchParams.get("subjectId");
    const mId = searchParams.get("moduleId");
    const tId = searchParams.get("topicId");
    const auto = searchParams.get("auto");
    const topicName = searchParams.get("topic");

    if (isStudy && tId) {
      const sig = `${sId}|${mId}|${tId}`;
      if (autoTriggeredRef.current === sig) return;
      autoTriggeredRef.current = sig;

      const timer = setTimeout(() => {
        if (sId) setSelectedSubjectId(sId);
        if (mId) setSelectedModuleId(mId);
        setSelectedTopicId(tId);
        setSidebarTab("ROADMAP");
        if (typeof window !== "undefined" && window.innerWidth < 768) {
          setIsFullscreen(true);
        }

        const foundTopicName =
          subjects
            .flatMap((s) => s.modules)
            .flatMap((m) => m.topics)
            .find((t) => t.id === tId)?.name || "topic";

        sendTutorRequest({
          action: "explain",
          subjectId: sId,
          moduleId: mId,
          topicId: tId,
          forceNewThread: true,
          displayLabel: `Explain: ${foundTopicName}`,
        });
        router.replace("/chat");
      }, 0);
      return () => clearTimeout(timer);
    }

    // Legacy ?auto=1 fallback
    if (auto === "1" && topicName) {
      const sig = `legacy|${topicName}`;
      if (autoTriggeredRef.current === sig) return;
      autoTriggeredRef.current = sig;

      const timer = setTimeout(() => {
        sendTutorRequest({
          action: "chat",
          message: `Explain "${topicName}" strictly using my uploaded notes.`,
          forceNewThread: true,
        });
        router.replace("/chat");
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [loading, searchParams, subjects, sendTutorRequest, router]);

  function startNewChat() {
    setActiveThreadId(null);
    setLastOpenedNotes([]);
    setLastWebSources([]);
    setMobileDrawerOpen(false);
  }

  function selectThread(t: Thread) {
    setActiveThreadId(t.id);
    setSelectedSubjectId(t.subjectId || "AUTO");
    setSelectedModuleId(t.moduleId || "NONE");
    setSelectedTopicId(t.topicId || "NONE");
    setLastOpenedNotes([]);
    setLastWebSources([]);
    setMobileDrawerOpen(false);
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

  async function toggleTopicDone(topic: TopicItem, nextState?: boolean) {
    const targetState = nextState ?? !topic.isCompleted;
    setSubjects((prev) =>
      prev.map((s) => ({
        ...s,
        modules: s.modules.map((m) => ({
          ...m,
          topics: m.topics.map((t) =>
            t.id === topic.id ? { ...t, isCompleted: targetState } : t,
          ),
        })),
      })),
    );
    try {
      const res = await fetch(`/api/topics/${topic.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isCompleted: targetState }),
      });
      if (!res.ok) throw new Error();
      return true;
    } catch {
      toast.error("Failed to update topic status");
      return false;
    }
  }

  async function handleMarkDoneAndNext() {
    if (!selectedTopic || !selectedModule || !selectedSubject) return;
    const ok = await toggleTopicDone(selectedTopic, true);
    if (!ok) return;

    const nextTarget = nextUncompletedTopic;
    if (nextTarget && nextTarget.id !== selectedTopic.id) {
      toast.success(`Completed "${selectedTopic.name}" — moving to "${nextTarget.name}"`);
      setSelectedTopicId(nextTarget.id);
      await sendTutorRequest({
        action: "explain",
        subjectId: selectedSubject.id,
        moduleId: selectedModule.id,
        topicId: nextTarget.id,
        displayLabel: `Explain: ${nextTarget.name}`,
      });
    } else {
      toast.success(`Completed "${selectedTopic.name}"! Module finished.`);
    }
  }

  async function handleNextTopicOnly() {
    if (!nextTopicInModule || !selectedModule || !selectedSubject) return;
    setSelectedTopicId(nextTopicInModule.id);
    await sendTutorRequest({
      action: "explain",
      subjectId: selectedSubject.id,
      moduleId: selectedModule.id,
      topicId: nextTopicInModule.id,
      displayLabel: `Explain: ${nextTopicInModule.name}`,
    });
  }

  async function handleExplainTopicFromRoadmap(topic: TopicItem) {
    if (!selectedSubject || !selectedModule) return;
    setSelectedTopicId(topic.id);
    setMobileDrawerOpen(false);
    await sendTutorRequest({
      action: "explain",
      subjectId: selectedSubject.id,
      moduleId: selectedModule.id,
      topicId: topic.id,
      displayLabel: `Explain: ${topic.name}`,
    });
  }

  async function handleRegenerateLast() {
    if (!activeThread || activeThread.messages.length === 0) return;
    const lastUser = [...activeThread.messages]
      .reverse()
      .find((m) => m.role === "user");
    const lastAssistant = [...activeThread.messages]
      .reverse()
      .find((m) => m.role === "assistant");
    const lastMeta = parseMeta(lastAssistant?.metadata);

    if (
      selectedTopic &&
      (lastMeta.action === "explain" || lastMeta.action === "regenerate")
    ) {
      await sendTutorRequest({
        action: "regenerate",
        topicId: selectedTopic.id,
        displayLabel: `Re-explain: ${selectedTopic.name}`,
      });
    } else if (lastMeta.action === "quiz" && selectedTopic) {
      await sendTutorRequest({
        action: "quiz",
        topicId: selectedTopic.id,
        displayLabel: `Quiz me on: ${selectedTopic.name}`,
      });
    } else if (lastMeta.action === "mock" && selectedTopic) {
      await sendTutorRequest({
        action: "mock",
        topicId: selectedTopic.id,
        displayLabel: `Mock exam questions: ${selectedTopic.name}`,
      });
    } else if (lastUser) {
      await sendTutorRequest({
        action: "chat",
        message: lastUser.content,
      });
    }
  }

  // Quick-launch targets for empty state (first uncompleted topic per subject)
  const quickContinueTargets = useMemo(() => {
    const items: Array<{
      subject: SubjectItem;
      module: ModuleItem;
      topic: TopicItem;
    }> = [];
    for (const s of subjects) {
      for (const m of s.modules) {
        const next = m.topics.find((t) => !t.isCompleted);
        if (next) {
          items.push({ subject: s, module: m, topic: next });
          break;
        }
      }
      if (items.length >= 4) break;
    }
    return items;
  }, [subjects]);

  const sidebarContent = (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-3 border-b border-glass-border/60 flex items-center justify-between gap-2">
        <div className="flex items-center rounded-lg bg-muted/60 p-0.5 flex-1">
          <button
            type="button"
            onClick={() => setSidebarTab("ROADMAP")}
            className={cn(
              "flex-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer",
              sidebarTab === "ROADMAP"
                ? "bg-primary/25 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Roadmap
          </button>
          <button
            type="button"
            onClick={() => setSidebarTab("CHATS")}
            className={cn(
              "flex-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer",
              sidebarTab === "CHATS"
                ? "bg-primary/25 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Chats ({threads.length})
          </button>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0"
          onClick={startNewChat}
          title="New Study Session"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-1.5 min-h-0">
        {sidebarTab === "ROADMAP" ? (
          selectedModule ? (
            <>
              <div className="px-1 pb-2 border-b border-glass-border/40 mb-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {selectedSubject?.name}
                </p>
                <p className="text-xs font-semibold text-foreground mt-0.5">
                  {selectedModule.name}
                </p>
              </div>
              {selectedModule.topics.length === 0 ? (
                <p className="text-xs text-muted-foreground px-1 py-4">
                  No topics in this module yet.
                </p>
              ) : (
                selectedModule.topics.map((t, idx) => {
                  const isActive = selectedTopicId === t.id;
                  return (
                    <div
                      key={t.id}
                      className={cn(
                        "flex items-start gap-2 rounded-lg px-2.5 py-2 text-xs border transition-colors",
                        isActive
                          ? "bg-primary/15 border-primary/40 text-foreground"
                          : t.isCompleted
                            ? "bg-emerald-500/5 border-emerald-500/20 text-muted-foreground"
                            : "border-transparent hover:bg-glass-hover text-foreground/90",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => toggleTopicDone(t)}
                        className="mt-0.5 shrink-0 cursor-pointer"
                        title={t.isCompleted ? "Mark incomplete" : "Mark done"}
                      >
                        {t.isCompleted ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                        ) : (
                          <Circle className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleExplainTopicFromRoadmap(t)}
                        disabled={sending}
                        className="flex-1 text-left min-w-0 cursor-pointer"
                      >
                        <span className="text-[10px] font-mono text-muted-foreground mr-1.5">
                          {idx + 1}.
                        </span>
                        <span
                          className={cn(
                            "break-words leading-snug",
                            t.isCompleted && "line-through opacity-75",
                          )}
                        >
                          {t.name}
                        </span>
                      </button>
                    </div>
                  );
                })
              )}
            </>
          ) : (
            <div className="space-y-3 px-1 py-2">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Pick a Subject &amp; Module above (or click{" "}
                <Link href="/progress" className="text-primary underline">
                  Explain in Progress
                </Link>
                ) to view its sequential topic roadmap.
              </p>
              {subjects.map((s) => (
                <div key={s.id} className="space-y-1">
                  <p className="text-[11px] font-semibold text-foreground/90 flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: s.color }}
                    />
                    <span className="truncate">{s.name}</span>
                  </p>
                  {s.modules.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        setSelectedSubjectId(s.id);
                        setSelectedModuleId(m.id);
                        const firstTodo =
                          m.topics.find((t) => !t.isCompleted) || m.topics[0];
                        setSelectedTopicId(firstTodo ? firstTodo.id : "NONE");
                      }}
                      className="w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs text-left text-muted-foreground hover:text-foreground hover:bg-glass-hover cursor-pointer"
                    >
                      <span className="truncate">{m.name}</span>
                      <ChevronRight className="h-3 w-3 shrink-0" />
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )
        ) : loading ? (
          <div className="h-24 rounded-lg shimmer" />
        ) : threads.length === 0 ? (
          <p className="text-xs text-muted-foreground px-1 py-4">
            No study conversations yet.
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
                type="button"
                onClick={() => selectThread(t)}
                className="truncate text-left flex-1 cursor-pointer min-w-0"
              >
                <span className="block truncate font-medium">{t.title}</span>
                {t.subject && (
                  <span className="block truncate text-[10px] opacity-75">
                    {t.subject.code || t.subject.name}
                    {t.topic ? ` • ${t.topic.name}` : ""}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => deleteThread(t.id)}
                className="text-muted-foreground hover:text-destructive cursor-pointer shrink-0 p-1"
                title="Delete conversation"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );

  const messages = activeThread?.messages || [];

  return (
    <div
      className={cn(
        isFullscreen
          ? "fixed inset-0 z-50 bg-background flex flex-col"
          : "flex flex-col h-[calc(100dvh-5rem)] md:h-[calc(100dvh-4.5rem)] -mx-2 sm:mx-0",
      )}
    >
      {/* Top Bar (Compact & Mobile-Friendly) */}
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-2 border-b border-glass-border/70 bg-background/95 backdrop-blur-md px-3 py-2.5 shrink-0",
          !isFullscreen && "rounded-t-2xl border-x border-t",
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 lg:hidden shrink-0"
            onClick={() => setMobileDrawerOpen(true)}
            title="Open Roadmap & Chats"
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-7 w-7 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
              <Bot className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-semibold leading-tight truncate">
                Course AI Tutor
              </h1>
              <p className="text-[11px] text-muted-foreground truncate">
                {selectedTopic
                  ? `${selectedModule?.name || ""} • Topic ${activeTopicIndex + 1}/${selectedModule?.topics.length || 0}`
                  : selectedSubject
                    ? `Grounded in ${selectedSubject.name} notes`
                    : "Strictly grounded in your uploaded PDFs & syllabus"}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <AiLogsButton
            size="sm"
            variant="outline"
            className="h-8 px-2.5 text-xs"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 px-2.5 text-xs"
            onClick={startNewChat}
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">New</span>
          </Button>
          <Button
            type="button"
            variant={isFullscreen ? "glow" : "outline"}
            size="sm"
            className="h-8 px-2.5 text-xs"
            onClick={() => setIsFullscreen((v) => !v)}
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen ChatGPT view"}
          >
            {isFullscreen ? (
              <>
                <Minimize2 className="h-3.5 w-3.5" />
                <span>Exit Full</span>
              </>
            ) : (
              <>
                <Maximize2 className="h-3.5 w-3.5" />
                <span>Fullscreen</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Course Scope Selector Strip */}
      <div
        className={cn(
          "flex flex-wrap items-center gap-2 px-3 py-2 border-b border-glass-border/50 bg-muted/25 shrink-0",
          !isFullscreen && "border-x",
        )}
      >
        <div className="flex items-center gap-1.5 min-w-[140px] flex-1 sm:flex-initial">
          <BookOpen className="h-3.5 w-3.5 text-primary shrink-0" />
          <Select
            value={selectedSubjectId}
            onValueChange={(val) => {
              setSelectedSubjectId(val);
              setSelectedModuleId("NONE");
              setSelectedTopicId("NONE");
            }}
          >
            <SelectTrigger className="h-8 text-xs min-w-[130px] sm:w-[190px]">
              <SelectValue placeholder="Subject (Auto)" />
            </SelectTrigger>
            <SelectContent className="z-[60]">
              <SelectItem value="AUTO">Auto-detect Subject</SelectItem>
              {subjects.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.code ? `${s.code} — ` : ""}
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedSubject && selectedSubject.modules.length > 0 && (
          <div className="flex items-center gap-1.5 min-w-[140px] flex-1 sm:flex-initial">
            <Layers className="h-3.5 w-3.5 text-accent shrink-0" />
            <Select
              value={selectedModuleId}
              onValueChange={(val) => {
                setSelectedModuleId(val);
                setSelectedTopicId("NONE");
                if (val !== "NONE") setSidebarTab("ROADMAP");
              }}
            >
              <SelectTrigger className="h-8 text-xs min-w-[130px] sm:w-[210px]">
                <SelectValue placeholder="All Modules" />
              </SelectTrigger>
              <SelectContent className="z-[60]">
                <SelectItem value="NONE">All Modules</SelectItem>
                {selectedSubject.modules.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {selectedModule && selectedModule.topics.length > 0 && (
          <div className="flex items-center gap-1.5 w-full sm:w-auto sm:flex-1 min-w-0">
            <Select
              value={selectedTopicId}
              onValueChange={(val) => setSelectedTopicId(val)}
            >
              <SelectTrigger className="h-8 text-xs w-full sm:max-w-[260px]">
                <SelectValue placeholder="Select Topic..." />
              </SelectTrigger>
              <SelectContent className="z-[60]">
                <SelectItem value="NONE">Module Overview / Free Q&amp;A</SelectItem>
                {selectedModule.topics.map((t, idx) => (
                  <SelectItem key={t.id} value={t.id}>
                    {idx + 1}. {t.name} {t.isCompleted ? "✓" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedTopic && (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 px-2.5 text-xs shrink-0"
                  disabled={sending}
                  onClick={() =>
                    sendTutorRequest({
                      action: "explain",
                      topicId: selectedTopic.id,
                      displayLabel: `Explain: ${selectedTopic.name}`,
                    })
                  }
                >
                  <Sparkles className="h-3 w-3 text-primary" />
                  <span className="hidden sm:inline">Explain</span>
                </Button>
                <button
                  type="button"
                  onClick={() => toggleTopicDone(selectedTopic)}
                  className={cn(
                    "h-8 px-2.5 rounded-lg text-xs font-medium border inline-flex items-center gap-1 shrink-0 cursor-pointer transition-colors",
                    selectedTopic.isCompleted
                      ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400"
                      : "border-glass-border text-muted-foreground hover:text-foreground",
                  )}
                  title="Toggle topic completion"
                >
                  {selectedTopic.isCompleted ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <Circle className="h-3.5 w-3.5" />
                  )}
                  <span className="hidden md:inline">
                    {selectedTopic.isCompleted ? "Done" : "Mark Done"}
                  </span>
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Main Split Workspace (Desktop Sidebar + Chat Stream) */}
      <div
        className={cn(
          "flex flex-1 min-h-0 overflow-hidden",
          !isFullscreen && "border-x border-b border-glass-border/70 rounded-b-2xl bg-card/30",
        )}
      >
        {/* Desktop Persistent Sidebar */}
        <aside className="hidden lg:flex w-72 shrink-0 flex-col border-r border-glass-border/60 bg-muted/20 min-h-0">
          {sidebarContent}
        </aside>

        {/* Mobile Drawer for Roadmap & Chats */}
        {mobileDrawerOpen && (
          <div className="lg:hidden fixed inset-0 z-[60] flex">
            <div
              className="fixed inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setMobileDrawerOpen(false)}
            />
            <div className="relative z-10 w-[84vw] max-w-[320px] h-full bg-sidebar border-r border-sidebar-border flex flex-col">
              <div className="flex items-center justify-between px-3 py-2.5 border-b border-sidebar-border">
                <span className="text-xs font-semibold">Study Navigator</span>
                <button
                  type="button"
                  onClick={() => setMobileDrawerOpen(false)}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 min-h-0">{sidebarContent}</div>
            </div>
          </div>
        )}

        {/* Chat Area */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-background/40">
          {/* Scrollable Messages */}
          <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 space-y-4">
            {messages.length === 0 && !pendingPrompt ? (
              <div className="h-full flex flex-col items-center justify-center text-center space-y-5 max-w-xl mx-auto px-2">
                <div className="h-14 w-14 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center">
                  <Bot className="h-7 w-7 text-primary" />
                </div>
                <div className="space-y-1.5">
                  <h2 className="text-lg font-semibold">
                    Syllabus-Grounded Study Tutor
                  </h2>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Answers strictly from your uploaded PDFs &amp; course notes — no
                    off-syllabus fluff. Pick a topic from{" "}
                    <Link href="/progress" className="text-primary underline">
                      Progress
                    </Link>{" "}
                    or resume below.
                  </p>
                </div>

                {quickContinueTargets.length > 0 && (
                  <div className="w-full space-y-2 text-left">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Next Topics To Master
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {quickContinueTargets.map(({ subject, module, topic }) => (
                        <button
                          key={topic.id}
                          type="button"
                          onClick={() => {
                            setSelectedSubjectId(subject.id);
                            setSelectedModuleId(module.id);
                            setSelectedTopicId(topic.id);
                            setSidebarTab("ROADMAP");
                            sendTutorRequest({
                              action: "explain",
                              subjectId: subject.id,
                              moduleId: module.id,
                              topicId: topic.id,
                              forceNewThread: true,
                              displayLabel: `Explain: ${topic.name}`,
                            });
                          }}
                          className="text-left rounded-xl border border-glass-border bg-muted/40 p-3 hover:border-primary/50 hover:bg-glass-hover transition-colors cursor-pointer space-y-1"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-medium text-accent truncate">
                              {subject.code || subject.name} • {module.name}
                            </span>
                            <Sparkles className="h-3 w-3 text-primary shrink-0" />
                          </div>
                          <p className="text-xs font-medium text-foreground line-clamp-2">
                            Explain: {topic.name}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[
                    "Summarize the key formulas and definitions from my uploaded notes for this module.",
                    "What are the most important exam concepts covered in these notes?",
                  ].map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() =>
                        sendTutorRequest({
                          action: "chat",
                          message: prompt,
                          forceNewThread: true,
                        })
                      }
                      className="text-left text-xs rounded-xl border border-glass-border/70 bg-muted/25 p-3 hover:border-primary/40 hover:bg-glass-hover transition-colors cursor-pointer text-muted-foreground hover:text-foreground"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map((m, idx) => {
                  const meta = parseMeta(m.metadata);
                  const isLastAssistant =
                    m.role === "assistant" && idx === messages.length - 1;
                  const notesList =
                    meta.openedNotes && meta.openedNotes.length > 0
                      ? meta.openedNotes
                      : isLastAssistant
                        ? lastOpenedNotes
                        : [];
                  const webList =
                    meta.webSources && meta.webSources.length > 0
                      ? meta.webSources
                      : isLastAssistant
                        ? lastWebSources
                        : [];

                  return (
                    <div key={m.id} className="space-y-2 max-w-4xl mx-auto">
                      <div
                        className={cn(
                          "flex items-start gap-2.5 sm:gap-3",
                          m.role === "user" ? "justify-end" : "justify-start",
                        )}
                      >
                        {m.role === "assistant" && (
                          <div className="h-7 w-7 sm:h-8 sm:w-8 rounded-lg bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                            <Bot className="h-4 w-4 text-primary" />
                          </div>
                        )}
                        <div
                          className={cn(
                            "rounded-2xl px-3.5 py-2.5 sm:px-4 sm:py-3 text-sm min-w-0",
                            m.role === "user"
                              ? "max-w-[88%] sm:max-w-[78%] bg-primary text-white"
                              : "flex-1 max-w-full sm:max-w-[90%] border border-glass-border bg-muted/45 text-foreground",
                          )}
                        >
                          {m.role === "user" ? (
                            <p className="whitespace-pre-wrap break-words">
                              {m.content}
                            </p>
                          ) : (
                            <>
                              {meta.topicName && (
                                <div className="flex items-center gap-1.5 flex-wrap pb-2 mb-2 border-b border-glass-border/40 text-[11px] text-muted-foreground">
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] border-primary/40 text-primary"
                                  >
                                    {meta.topicName}
                                  </Badge>
                                  {meta.moduleName && (
                                    <span className="truncate">
                                      {meta.moduleName}
                                    </span>
                                  )}
                                  {meta.model && (
                                    <span className="ml-auto font-mono text-[10px] opacity-70">
                                      {meta.model}
                                    </span>
                                  )}
                                </div>
                              )}
                              <MarkdownRenderer content={m.content} />
                            </>
                          )}
                        </div>
                        {m.role === "user" && (
                          <div className="h-7 w-7 sm:h-8 sm:w-8 rounded-lg bg-secondary/20 flex items-center justify-center shrink-0 mt-0.5">
                            <User className="h-4 w-4 text-secondary" />
                          </div>
                        )}
                      </div>

                      {/* Grounded Sources Row */}
                      {m.role === "assistant" &&
                        (notesList.length > 0 || webList.length > 0) && (
                          <div className="pl-9 sm:pl-11 flex items-center gap-1.5 flex-wrap">
                            {notesList.map((n) => (
                              <Badge
                                key={n.id}
                                variant="outline"
                                className="text-[10px] gap-1"
                              >
                                <FileText className="h-2.5 w-2.5 text-primary" />
                                Source: {n.title}
                              </Badge>
                            ))}
                            {webList.map((s, wIdx) => (
                              <a
                                key={wIdx}
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

                      {/* Interactive Tutor Action Bar on Latest Assistant Response */}
                      {isLastAssistant && !sending && !pendingPrompt && (
                        <div className="pl-9 sm:pl-11 flex items-center gap-1.5 flex-wrap pt-1">
                          {selectedTopic && (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 px-2.5 text-xs gap-1.5"
                                onClick={() =>
                                  sendTutorRequest({
                                    action: "quiz",
                                    topicId: selectedTopic.id,
                                    displayLabel: `Quiz me on: ${selectedTopic.name}`,
                                  })
                                }
                              >
                                <Brain className="h-3.5 w-3.5 text-primary" />
                                Quiz Me
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 px-2.5 text-xs gap-1.5"
                                onClick={() =>
                                  sendTutorRequest({
                                    action: "mock",
                                    topicId: selectedTopic.id,
                                    displayLabel: `Mock exam questions: ${selectedTopic.name}`,
                                  })
                                }
                              >
                                <ClipboardList className="h-3.5 w-3.5 text-accent" />
                                Mock Questions
                              </Button>
                              {!selectedTopic.isCompleted && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="glow"
                                  className="h-7 px-2.5 text-xs gap-1.5"
                                  onClick={handleMarkDoneAndNext}
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  {nextUncompletedTopic
                                    ? "Mark Understood & Next"
                                    : "Mark Understood"}
                                </Button>
                              )}
                              {nextTopicInModule && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2.5 text-xs gap-1"
                                  onClick={handleNextTopicOnly}
                                >
                                  <span>Next Topic</span>
                                  <ArrowRight className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </>
                          )}
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2.5 text-xs gap-1 text-muted-foreground hover:text-foreground"
                            onClick={handleRegenerateLast}
                          >
                            <RotateCcw className="h-3 w-3" />
                            Regenerate
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}

                {pendingPrompt && (
                  <div className="space-y-3 max-w-4xl mx-auto">
                    <div className="flex items-start gap-2.5 sm:gap-3 justify-end">
                      <div className="max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm bg-primary text-white">
                        <p className="whitespace-pre-wrap">{pendingPrompt}</p>
                      </div>
                      <div className="h-7 w-7 sm:h-8 sm:w-8 rounded-lg bg-secondary/20 flex items-center justify-center shrink-0 mt-0.5">
                        <User className="h-4 w-4 text-secondary" />
                      </div>
                    </div>

                    <div className="flex items-start gap-2.5 sm:gap-3 justify-start">
                      <div className="h-7 w-7 sm:h-8 sm:w-8 rounded-lg bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                        <Bot className="h-4 w-4 text-primary" />
                      </div>
                      <div className="flex-1 max-w-full sm:max-w-[90%] rounded-2xl border border-glass-border bg-muted/45 p-3.5 sm:p-4 space-y-3">
                        <AiDebugPanel
                          active={debugModeActive}
                          loading={sending && !streamingReply}
                          elapsedSeconds={elapsed}
                          thinkingText={streamingThinking}
                          promptText={streamingPrompt}
                          model={debugModel}
                        />
                        {lastOpenedNotes.length > 0 && (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {lastOpenedNotes.map((n) => (
                              <Badge
                                key={n.id}
                                variant="outline"
                                className="text-[10px] gap-1"
                              >
                                <FileText className="h-2.5 w-2.5 text-primary" />
                                Reading: {n.title}
                              </Badge>
                            ))}
                          </div>
                        )}
                        {streamingReply ? (
                          <MarkdownRenderer content={streamingReply} />
                        ) : (
                          <>
                            <div className="flex items-center gap-2 text-xs text-accent font-medium">
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                              <span>
                                Extracting relevant topic material &amp; writing response ({elapsed}s)
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
                  </div>
                )}

                <div ref={bottomRef} />
              </>
            )}
          </div>

          {/* Sticky Composer */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendTutorRequest({ action: "chat" });
            }}
            className="shrink-0 border-t border-glass-border/60 bg-background/95 backdrop-blur-md px-3 sm:px-5 pt-2.5 pb-[max(0.65rem,env(safe-area-inset-bottom))]"
          >
            <div className="max-w-4xl mx-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setUseThinking((v) => !v)}
                className={cn(
                  "h-10 px-2.5 rounded-xl text-xs font-medium border inline-flex items-center gap-1.5 shrink-0 cursor-pointer transition-colors",
                  useThinking
                    ? "bg-primary/20 border-primary text-primary"
                    : "border-glass-border text-muted-foreground hover:text-foreground",
                )}
                title="Toggle extended model thinking (Off = fast, loop-free answers)"
              >
                <Brain className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">
                  Think {useThinking ? "On" : "Off"}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setUseWebSearch((v) => !v)}
                className={cn(
                  "h-10 px-2.5 rounded-xl text-xs font-medium border inline-flex items-center gap-1.5 shrink-0 cursor-pointer transition-colors",
                  useWebSearch
                    ? "bg-primary/20 border-primary text-primary"
                    : "border-glass-border text-muted-foreground hover:text-foreground",
                )}
                title="Optional web grounding if topic isn't in uploaded PDFs"
              >
                <Globe className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">
                  Web {useWebSearch ? "On" : "Off"}
                </span>
              </button>
              <Input
                placeholder={
                  selectedTopic
                    ? `Ask a doubt or reply to quiz on "${selectedTopic.name}"...`
                    : selectedSubject
                      ? `Ask about ${selectedSubject.name} notes...`
                      : "Ask a course question from your uploaded notes..."
                }
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={sending}
                className="h-10"
              />
              {sending ? (
                <Button
                  type="button"
                  variant="destructive"
                  className="h-10 px-3.5 shrink-0 gap-1.5"
                  onClick={stopGeneration}
                  title="Stop AI generation"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                  <span className="hidden sm:inline text-xs">Stop</span>
                </Button>
              ) : (
                <Button
                  type="submit"
                  variant="glow"
                  className="h-10 px-3.5 shrink-0"
                  disabled={!input.trim()}
                >
                  <Send className="h-4 w-4" />
                </Button>
              )}
            </div>
          </form>
        </div>
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
          <div className="h-[75dvh] rounded-xl shimmer" />
        </div>
      }
    >
      <ChatWorkspace />
    </Suspense>
  );
}
