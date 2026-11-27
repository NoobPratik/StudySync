"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Clock,
  Sparkles,
  Shield,
  Save,
  LogOut,
  Cpu,
  RefreshCw,
  CheckCircle2,
  Loader2,
  Zap,
  Bell,
  Smartphone,
} from "lucide-react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { signOut, useSession } from "@/lib/auth-client";

const AI_PRESETS = [
  {
    label: "Groq (Free Cloud & Fast)",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
    fastModel: "llama-3.1-8b-instant",
    timeoutSeconds: 60,
    hint: "Free tier at console.groq.com — ultra-fast cloud inference.",
  },
  {
    label: "Gemini (Free Tier)",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.5-flash",
    fastModel: "gemini-2.5-flash-lite",
    timeoutSeconds: 90,
    hint: "Free API key at aistudio.google.com.",
  },
  {
    label: "OpenRouter (Free Models)",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "meta-llama/llama-3.3-70b-instruct:free",
    fastModel: "google/gemma-3-4b-it:free",
    timeoutSeconds: 120,
    hint: "Free :free models at openrouter.ai.",
  },
  {
    label: "Ollama (Local 8GB VRAM)",
    baseUrl: "http://localhost:11434/v1",
    model: "qwen3.5:9b",
    fastModel: "qwen3.5:4b",
    timeoutSeconds: 300,
    hint: "Uses 9B for tutoring/assignments and 4B for quick topic extraction.",
  },
  {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o",
    fastModel: "gpt-4o-mini",
    timeoutSeconds: 120,
    hint: "Requires an OpenAI API key.",
  },
];

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray.buffer;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function SettingsPage() {
  const router = useRouter();
  const { data: session } = useSession();

  const [focusMinutes, setFocusMinutes] = useState(25);
  const [shortBreakMinutes, setShortBreakMinutes] = useState(5);
  const [longBreakMinutes, setLongBreakMinutes] = useState(15);

  const [baseUrl, setBaseUrl] = useState("http://localhost:11434/v1");
  const [apiKey, setApiKey] = useState("");
  const [maskedApiKey, setMaskedApiKey] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [model, setModel] = useState("qwen3.5:9b");
  const [fastModel, setFastModel] = useState("");
  const [timeoutSeconds, setTimeoutSeconds] = useState(300);
  const [customInstructions, setCustomInstructions] = useState("");
  const [temperature, setTemperature] = useState(0.4);
  const [debugMode, setDebugMode] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [pickingFor, setPickingFor] = useState<"primary" | "fast">("primary");

  const [savingAi, setSavingAi] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [testingAi, setTestingAi] = useState(false);
  const [testReply, setTestReply] = useState<string | null>(null);

  // PWA & Push Notification preferences
  const [notifEnabled, setNotifEnabled] = useState(true);
  const [classLeadMinutes, setClassLeadMinutes] = useState(5);
  const [deadlineLeadHours, setDeadlineLeadHours] = useState(24);
  const [vapidPublicKey, setVapidPublicKey] = useState("");
  const [subCount, setSubCount] = useState(0);
  const [savingNotifs, setSavingNotifs] = useState(false);
  const [testingPush, setTestingPush] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        const saved = localStorage.getItem("studysync_pomodoro_prefs");
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed.focusMinutes) setFocusMinutes(parsed.focusMinutes);
          if (parsed.shortBreakMinutes)
            setShortBreakMinutes(parsed.shortBreakMinutes);
          if (parsed.longBreakMinutes)
            setLongBreakMinutes(parsed.longBreakMinutes);
        }
      } catch {
        // Ignore
      }
    });

    fetch("/api/ai/config")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data?.config) return;
        setBaseUrl(data.config.baseUrl || "http://localhost:11434/v1");
        setModel(data.config.model || "qwen3.5:9b");
        setFastModel(data.config.fastModel || "");
        setTimeoutSeconds(data.config.timeoutSeconds ?? 300);
        setHasApiKey(Boolean(data.config.hasApiKey));
        setMaskedApiKey(data.config.maskedApiKey || "");
        setCustomInstructions(data.config.customInstructions || "");
        setTemperature(data.config.temperature ?? 0.4);
        setDebugMode(Boolean(data.config.debugMode));
      })
      .catch(() => {});

    fetch("/api/notifications/preferences")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data) return;
        if (data.preferences) {
          setNotifEnabled(Boolean(data.preferences.enabled));
          setClassLeadMinutes(data.preferences.classLeadMinutes ?? 5);
          setDeadlineLeadHours(data.preferences.deadlineLeadHours ?? 24);
        }
        setSubCount(data.subscriptionCount ?? 0);
        setVapidPublicKey(data.vapidPublicKey || "");
      })
      .catch(() => {});

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      if (active) setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    return () => {
      active = false;
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
    };
  }, []);

  async function saveAiConfig(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setSavingAi(true);
    try {
      const payload: Record<string, unknown> = {
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        fastModel: fastModel.trim() || null,
        timeoutSeconds: Math.max(30, Math.min(900, Number(timeoutSeconds) || 300)),
        customInstructions: customInstructions.trim() || null,
        temperature: Number(temperature) || 0.4,
        debugMode,
      };
      if (apiKey.trim() !== "") {
        payload.apiKey = apiKey.trim();
      }

      const res = await fetch("/api/ai/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to save");
      setHasApiKey(Boolean(json.config?.hasApiKey));
      setMaskedApiKey(json.config?.maskedApiKey || "");
      setApiKey("");
      toast.success("AI multi-model configuration saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save AI config");
    } finally {
      setSavingAi(false);
    }
  }

  async function fetchModels() {
    setFetchingModels(true);
    try {
      const res = await fetch("/api/ai/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "list_models",
          baseUrl: baseUrl.trim(),
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not fetch models");
      const list: string[] = json.models || [];
      setAvailableModels(list);
      toast.success(
        list.length > 0
          ? `Found ${list.length} model(s)`
          : "Endpoint reachable, no models listed",
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not list models from provider",
      );
    } finally {
      setFetchingModels(false);
    }
  }

  async function testConnection() {
    setTestingAi(true);
    setTestReply(null);
    try {
      await saveAiConfig();
      const res = await fetch("/api/ai/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test", tier: "primary" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Connection test failed");
      setTestReply(`${json.model}: ${json.reply}`);
      toast.success("AI model responded!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI test failed");
    } finally {
      setTestingAi(false);
    }
  }

  async function handleEnablePushOnDevice() {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window)
    ) {
      toast.error(
        "Web Push requires a modern browser (or iOS Safari after adding StudySync to your Home Screen).",
      );
      return;
    }

    setSavingNotifs(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        toast.error("Browser notification permission was denied.");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      let pubKey = vapidPublicKey;
      if (!pubKey) {
        const prefRes = await fetch("/api/notifications/preferences");
        const prefJson = await prefRes.json();
        pubKey = prefJson.vapidPublicKey;
        setVapidPublicKey(pubKey || "");
      }
      if (!pubKey) throw new Error("VAPID key unavailable");

      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(pubKey),
      });

      const subRes = await fetch("/api/notifications/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!subRes.ok) throw new Error("Subscription save failed");
      const subJson = await subRes.json();
      setSubCount(subJson.subscriptionCount ?? 1);
      setNotifEnabled(true);
      toast.success("This device is now registered for push alerts!");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not enable push notifications",
      );
    } finally {
      setSavingNotifs(false);
    }
  }

  async function saveNotifPreferences(e: React.FormEvent) {
    e.preventDefault();
    setSavingNotifs(true);
    try {
      const res = await fetch("/api/notifications/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: notifEnabled,
          classLeadMinutes: Math.max(1, Math.min(180, Number(classLeadMinutes) || 5)),
          deadlineLeadHours: Math.max(1, Math.min(168, Number(deadlineLeadHours) || 24)),
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Push reminder timing saved!");
    } catch {
      toast.error("Failed to save notification settings");
    } finally {
      setSavingNotifs(false);
    }
  }

  async function sendTestPush() {
    setTestingPush(true);
    try {
      const res = await fetch("/api/notifications/test", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Test failed");
      toast.success(`Test notification dispatched to ${json.sent} device(s)!`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test notification failed");
    } finally {
      setTestingPush(false);
    }
  }

  async function handleInstallApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") {
      toast.success("Installing StudySync app...");
      setInstallPrompt(null);
    }
  }

  function savePomodoroPrefs(e: React.FormEvent) {
    e.preventDefault();
    try {
      localStorage.setItem(
        "studysync_pomodoro_prefs",
        JSON.stringify({
          focusMinutes: Math.max(1, Number(focusMinutes) || 25),
          shortBreakMinutes: Math.max(1, Number(shortBreakMinutes) || 5),
          longBreakMinutes: Math.max(1, Number(longBreakMinutes) || 15),
        }),
      );
      toast.success("Pomodoro timer defaults updated");
    } catch {
      toast.error("Could not save preferences");
    }
  }

  async function handleSignOut() {
    await signOut({
      fetchOptions: {
        onSuccess: () => {
          router.push("/login");
          router.refresh();
        },
      },
    });
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1 className="text-2xl sm:text-3xl font-bold">
          Workspace <span className="gradient-text">Settings</span>
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure dual-model OpenAI-compatible AI (e.g. 9B + 4B), timeouts,
          and Pomodoro defaults
        </p>
      </motion.div>

      <Card className="gradient-border">
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Cpu className="h-4 w-4 text-primary" />
              Multi-Model AI Engine (OpenAI-Compatible)
            </CardTitle>
            <Badge>Dual-Tier Routing</Badge>
          </div>
          <CardDescription>
            Use a larger model (e.g. 9B) for Study Tutor & Assignment Solutions,
            and an optional fast smaller model (e.g. 4B) for Topic Extraction,
            Auto-Categorizing & WhatsApp parsing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveAiConfig} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Quick Provider Presets
              </Label>
              <div className="flex items-center gap-2 flex-wrap">
                {AI_PRESETS.map((p) => (
                  <Button
                    key={p.label}
                    type="button"
                    size="sm"
                    variant={baseUrl === p.baseUrl ? "default" : "outline"}
                    onClick={() => {
                      setBaseUrl(p.baseUrl);
                      setModel(p.model);
                      setFastModel(p.fastModel);
                      setTimeoutSeconds(p.timeoutSeconds);
                      toast.info(p.hint);
                    }}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-base-url">API Base URL</Label>
              <Input
                id="ai-base-url"
                placeholder="http://localhost:11434/v1"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="ai-model">Primary Model (Tutor & Answers)</Label>
                  <button
                    type="button"
                    onClick={() => {
                      setPickingFor("primary");
                      fetchModels();
                    }}
                    disabled={fetchingModels}
                    className="text-xs text-accent hover:text-primary inline-flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw
                      className={`h-3 w-3 ${fetchingModels ? "animate-spin" : ""}`}
                    />
                    Fetch
                  </button>
                </div>
                <Input
                  id="ai-model"
                  placeholder="qwen3.5:9b"
                  value={model}
                  onFocus={() => setPickingFor("primary")}
                  onChange={(e) => setModel(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="ai-fast-model" className="flex items-center gap-1">
                    <Zap className="h-3.5 w-3.5 text-amber-400" />
                    Fast Model (Extraction & Sorting)
                  </Label>
                </div>
                <Input
                  id="ai-fast-model"
                  placeholder="qwen3.5:4b (optional)"
                  value={fastModel}
                  onFocus={() => setPickingFor("fast")}
                  onChange={(e) => setFastModel(e.target.value)}
                />
              </div>
            </div>

            {availableModels.length > 0 && (
              <div className="rounded-lg border border-glass-border bg-muted/30 p-2.5 space-y-1.5">
                <p className="text-[11px] text-muted-foreground">
                  Click a model to assign to{" "}
                  <span className="text-accent font-medium">
                    {pickingFor === "primary" ? "Primary Model" : "Fast Model"}
                  </span>{" "}
                  (click field above to switch target):
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {availableModels.slice(0, 16).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() =>
                        pickingFor === "primary"
                          ? setModel(m)
                          : setFastModel(m)
                      }
                      className={`text-[11px] px-2 py-0.5 rounded border cursor-pointer transition-colors ${
                        (pickingFor === "primary" ? model : fastModel) === m
                          ? "bg-primary/25 border-primary text-primary"
                          : "border-glass-border text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="ai-key">
                  API Key{" "}
                  <span className="text-xs text-muted-foreground font-normal">
                    (optional for Ollama)
                  </span>
                </Label>
                <Input
                  id="ai-key"
                  type="password"
                  placeholder={
                    hasApiKey
                      ? `Saved (${maskedApiKey}) — type to replace`
                      : "Leave empty for Ollama, or paste API key"
                  }
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="ai-timeout">Request Timeout (sec)</Label>
                <Input
                  id="ai-timeout"
                  type="number"
                  min={30}
                  max={900}
                  value={timeoutSeconds}
                  onChange={(e) => setTimeoutSeconds(Number(e.target.value))}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-start">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="ai-instructions">
                  Custom System Instructions (Optional)
                </Label>
                <Textarea
                  id="ai-instructions"
                  rows={3}
                  placeholder="e.g., I'm a 1st year CSE student. Give deep university-level explanations with C code & step-by-step derivations."
                  value={customInstructions}
                  onChange={(e) => setCustomInstructions(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ai-temp">Temperature ({temperature})</Label>
                <Input
                  id="ai-temp"
                  type="number"
                  step="0.1"
                  min={0}
                  max={1.5}
                  value={temperature}
                  onChange={(e) => setTemperature(Number(e.target.value))}
                />
              </div>
            </div>

            {/* AI Debug Mode Toggle */}
            <label
              htmlFor="ai-debug-mode"
              className="flex items-start gap-3 rounded-xl border border-glass-border bg-muted/35 p-3.5 cursor-pointer hover:border-primary/40 transition-colors"
            >
              <input
                id="ai-debug-mode"
                type="checkbox"
                checked={debugMode}
                onChange={(e) => setDebugMode(e.target.checked)}
                className="mt-1 h-4 w-4 rounded accent-primary cursor-pointer"
              />
              <div className="space-y-0.5 text-xs">
                <p className="font-semibold text-foreground">
                  AI Debug Mode — Stream Live Thinking &amp; Reasoning Trace
                </p>
                <p className="text-muted-foreground leading-relaxed">
                  When enabled, AI Tutor, Assignment Solver, Timetable Importer,
                  and Study Planner display live model thinking tokens instead
                  of only a loading spinner so you can inspect reasoning or slow
                  Ollama runs in real time.
                </p>
              </div>
            </label>

            {testReply && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300 flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{testReply}</span>
              </div>
            )}

            <div className="flex items-center gap-3 flex-wrap pt-1">
              <Button type="submit" variant="glow" disabled={savingAi}>
                {savingAi ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Saving...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" /> Save AI Settings
                  </>
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={testConnection}
                disabled={testingAi}
              >
                {testingAi ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Testing...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 text-primary" /> Test Connection
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Bell className="h-4 w-4 text-primary" />
              Mobile PWA &amp; Push Notifications
            </CardTitle>
            <Badge variant={subCount > 0 ? "success" : "outline"}>
              {subCount} device{subCount === 1 ? "" : "s"} active
            </Badge>
          </div>
          <CardDescription>
            Install StudySync on your phone/desktop and get push alerts before
            upcoming classes and deadlines (works over HTTPS or localhost).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Device Registration + PWA Install */}
          <div className="rounded-xl border border-glass-border bg-muted/35 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1 text-xs">
              <p className="font-semibold text-foreground flex items-center gap-1.5">
                <Smartphone className="h-3.5 w-3.5 text-primary" />
                This Device
              </p>
              <p className="text-muted-foreground">
                Android/Desktop: click Enable Push below or Install App. On
                iPhone/iPad Safari, tap Share -&gt; Add to Home Screen first.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap shrink-0">
              {installPrompt && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleInstallApp}
                >
                  <Smartphone className="h-3.5 w-3.5 text-primary" /> Install App
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="glow"
                onClick={handleEnablePushOnDevice}
                disabled={savingNotifs}
              >
                <Bell className="h-3.5 w-3.5" /> Enable Push Notifications
              </Button>
              {subCount > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={sendTestPush}
                  disabled={testingPush}
                >
                  {testingPush ? "Sending..." : "Test Alert"}
                </Button>
              )}
            </div>
          </div>

          <form onSubmit={saveNotifPreferences} className="space-y-4">
            <label className="flex items-center gap-2.5 text-xs font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={notifEnabled}
                onChange={(e) => setNotifEnabled(e.target.checked)}
                className="h-4 w-4 rounded accent-primary cursor-pointer"
              />
              <span>Enable automated class &amp; deadline reminders</span>
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="notif-class-mins">
                  Notify before class/lab (minutes)
                </Label>
                <Input
                  id="notif-class-mins"
                  type="number"
                  min={1}
                  max={180}
                  value={classLeadMinutes}
                  onChange={(e) => setClassLeadMinutes(Number(e.target.value))}
                />
                <div className="flex items-center gap-1.5">
                  {[5, 10, 15, 30].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setClassLeadMinutes(m)}
                      className={`px-2 py-0.5 rounded text-[11px] border cursor-pointer ${
                        classLeadMinutes === m
                          ? "bg-primary/20 border-primary text-primary"
                          : "border-glass-border text-muted-foreground"
                      }`}
                    >
                      {m}m
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notif-dl-hours">
                  Notify before deadline (hours)
                </Label>
                <Input
                  id="notif-dl-hours"
                  type="number"
                  min={1}
                  max={168}
                  value={deadlineLeadHours}
                  onChange={(e) => setDeadlineLeadHours(Number(e.target.value))}
                />
                <div className="flex items-center gap-1.5">
                  {[
                    { h: 6, label: "6h" },
                    { h: 12, label: "12h" },
                    { h: 24, label: "1 day (24h)" },
                    { h: 48, label: "2 days (48h)" },
                  ].map((opt) => (
                    <button
                      key={opt.h}
                      type="button"
                      onClick={() => setDeadlineLeadHours(opt.h)}
                      className={`px-2 py-0.5 rounded text-[11px] border cursor-pointer ${
                        deadlineLeadHours === opt.h
                          ? "bg-primary/20 border-primary text-primary"
                          : "border-glass-border text-muted-foreground"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <Button type="submit" variant="outline" size="sm" disabled={savingNotifs}>
              <Save className="h-3.5 w-3.5" /> Save Notification Timing
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4 text-primary" />
            Pomodoro Defaults
          </CardTitle>
          <CardDescription>
            Customize your default session lengths (in minutes).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={savePomodoroPrefs} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="set-focus">Focus (min)</Label>
                <Input
                  id="set-focus"
                  type="number"
                  min={1}
                  max={120}
                  value={focusMinutes}
                  onChange={(e) => setFocusMinutes(Number(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="set-short">Short Break (min)</Label>
                <Input
                  id="set-short"
                  type="number"
                  min={1}
                  max={30}
                  value={shortBreakMinutes}
                  onChange={(e) => setShortBreakMinutes(Number(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="set-long">Long Break (min)</Label>
                <Input
                  id="set-long"
                  type="number"
                  min={1}
                  max={60}
                  value={longBreakMinutes}
                  onChange={(e) => setLongBreakMinutes(Number(e.target.value))}
                />
              </div>
            </div>
            <Button type="submit" variant="outline" size="sm">
              <Save className="h-3.5 w-3.5" /> Save Timer Defaults
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4 text-emerald-400" />
            Account Session
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">
              Signed in as {session?.user?.name || "Student"}
            </p>
            <p className="text-xs text-muted-foreground">
              {session?.user?.email}
            </p>
          </div>
          <Button variant="destructive" size="sm" onClick={handleSignOut}>
            <LogOut className="h-4 w-4" /> Sign Out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
