import { Suspense } from "react";
import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import {
  Calendar,
  Clock,
  FileText,
  Target,
  BarChart3,
  ArrowRight,
  Zap,
  Shield,
  MessageSquareText,
} from "lucide-react";
import { getSession } from "@/lib/session";

const features = [
  {
    icon: Calendar,
    title: "Smart Academic Calendar",
    description:
      "Track weekly recurring lectures, lab sessions, holidays, and exam dates in Week, Month, and Day views.",
    color: "from-violet-500/20 to-purple-500/5",
    iconColor: "text-violet-400",
  },
  {
    icon: Target,
    title: "Deadline & WhatsApp Extractor",
    description:
      "Manage assignments, lab exams, mid-sems, and end-sems—or parse WhatsApp group exports with AI in seconds.",
    color: "from-fuchsia-500/20 to-pink-500/5",
    iconColor: "text-fuchsia-400",
  },
  {
    icon: FileText,
    title: "Subject Kanban Notes Vault",
    description:
      "Organize PDFs, PPTs, and DOCX modules cleanly by subject in alphabetical order with AI auto-categorization.",
    color: "from-indigo-500/20 to-blue-500/5",
    iconColor: "text-indigo-400",
  },
  {
    icon: Clock,
    title: "Focus Pomodoro Engine",
    description:
      "Stay locked in with customizable focus & break cycles, subject tagging, and real session analytics.",
    color: "from-purple-500/20 to-violet-500/5",
    iconColor: "text-purple-400",
  },
  {
    icon: BarChart3,
    title: "Syllabus Pacing & Progress",
    description:
      "Extract modules from notes or check off topics to balance topics left against days left until exams.",
    color: "from-emerald-500/20 to-teal-500/5",
    iconColor: "text-emerald-400",
  },
  {
    icon: MessageSquareText,
    title: "OpenAI-Compatible AI Tutor",
    description:
      "Plug in local Ollama (e.g. Qwen 3.5 9B), OpenAI, or Gemini for context-aware study chat and smart prioritization.",
    color: "from-amber-500/20 to-orange-500/5",
    iconColor: "text-amber-400",
  },
];

function LandingContent() {
  return (
    <div className="min-h-screen bg-background bg-grid relative overflow-hidden">
      <div className="pointer-events-none fixed -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-primary/15 blur-[120px]" />
      <div className="pointer-events-none fixed top-1/3 -right-40 h-[450px] w-[450px] rounded-full bg-secondary/15 blur-[120px]" />

      <header className="relative z-10 border-b border-glass-border/60 backdrop-blur-md bg-background/60">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <Image
              src="/brand/logo.png"
              alt="StudySync Logo"
              width={36}
              height={36}
              className="h-9 w-9 rounded-lg object-contain drop-shadow-[0_0_12px_rgba(124,58,237,0.45)]"
            />
            <span className="text-xl font-bold gradient-text">StudySync</span>
          </Link>

          <nav className="flex items-center gap-3">
            <Link
              href="/login"
              className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/register"
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white shadow-lg shadow-primary/30 hover:bg-primary/90 transition-all"
            >
              Get Started
              <ArrowRight className="h-4 w-4" />
            </Link>
          </nav>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-7xl px-6 pt-20 pb-24">
        <div className="mx-auto max-w-3xl text-center space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-medium text-accent">
            <Zap className="h-3.5 w-3.5 text-primary" />
            Built for Modern College Students
          </div>

          <h1 className="text-4xl sm:text-6xl font-bold tracking-tight text-foreground leading-[1.1]">
            Master Your Semester with{" "}
            <span className="gradient-text glow-text">Precision & Clarity</span>
          </h1>

          <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            One futuristic command center for your lectures, deadlines, study
            notes, Pomodoro focus sessions, syllabus progress, and local or
            cloud AI assistance.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
            <Link
              href="/register"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-7 py-3.5 text-base font-semibold text-white shadow-xl glow-purple hover:bg-primary/90 transition-all"
            >
              Launch Workspace
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/login"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl border border-glass-border bg-card/60 px-7 py-3.5 text-base font-medium text-foreground hover:border-primary/50 hover:bg-glass-hover transition-all"
            >
              Sign In to Account
            </Link>
          </div>
        </div>

        <section className="mt-14 mx-auto max-w-5xl">
          <div className="glass-card gradient-border p-2 sm:p-3 overflow-hidden shadow-2xl glow-purple">
            <Image
              src="/brand/preview.png"
              alt="StudySync AI Study Assistant Workspace Preview"
              width={1440}
              height={804}
              priority
              className="w-full h-auto rounded-xl object-cover"
            />
          </div>
        </section>

        <section className="mt-20 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f) => (
            <div
              key={f.title}
              className="glass-card p-6 group relative overflow-hidden"
            >
              <div
                className={`absolute inset-0 bg-gradient-to-br ${f.color} opacity-0 group-hover:opacity-100 transition-opacity duration-300`}
              />
              <div className="relative z-10 space-y-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 border border-primary/25">
                  <f.icon className={`h-5 w-5 ${f.iconColor}`} />
                </div>
                <h3 className="text-lg font-semibold text-foreground">
                  {f.title}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {f.description}
                </p>
              </div>
            </div>
          ))}
        </section>

        <section className="mt-20 glass-card gradient-border p-8 sm:p-10 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="space-y-2 text-center md:text-left">
            <div className="inline-flex items-center gap-2 text-xs font-medium text-accent">
              <Shield className="h-4 w-4 text-primary" />
              Universal Student Profile • Ollama & OpenAI Compatible
            </div>
            <h2 className="text-2xl font-bold text-foreground">
              Ready to organize your college life?
            </h2>
            <p className="text-sm text-muted-foreground">
              Create your account in seconds — works for any degree, branch, or
              university.
            </p>
          </div>
          <Link
            href="/register"
            className="shrink-0 inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-white shadow-lg glow-purple hover:bg-primary/90 transition-all"
          >
            Create Free Account
            <ArrowRight className="h-4 w-4" />
          </Link>
        </section>
      </main>
    </div>
  );
}

async function HomeGate() {
  const session = await getSession();
  if (session?.user) {
    redirect("/dashboard");
  }
  return <LandingContent />;
}

export default function LandingPage() {
  return (
    <Suspense fallback={<LandingContent />}>
      <HomeGate />
    </Suspense>
  );
}
