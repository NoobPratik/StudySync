"use client";

import { motion } from "framer-motion";
import { LucideIcon } from "lucide-react";

interface StudyHeroBannerProps {
  icon: LucideIcon;
  eyebrow?: string;
  accentColor?: "violet" | "emerald" | "indigo" | "amber";
}

export function StudyHeroEmblem({
  icon: Icon,
  eyebrow,
  accentColor = "violet",
}: StudyHeroBannerProps) {
  const palette = {
    violet: "from-violet-500/25 via-fuchsia-500/15 to-indigo-500/25 text-violet-300 border-violet-500/30",
    emerald: "from-emerald-500/25 via-teal-500/15 to-cyan-500/25 text-emerald-300 border-emerald-500/30",
    indigo: "from-indigo-500/25 via-blue-500/15 to-purple-500/25 text-indigo-300 border-indigo-500/30",
    amber: "from-amber-500/25 via-orange-500/15 to-rose-500/25 text-amber-300 border-amber-500/30",
  }[accentColor];

  return (
    <div className="inline-flex items-center gap-2.5 mb-2">
      <motion.div
        initial={{ scale: 0.9, rotate: -6 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 20 }}
        className={`h-9 w-9 rounded-xl bg-gradient-to-br border flex items-center justify-center shadow-lg ${palette}`}
      >
        <Icon className="h-4.5 w-4.5" />
      </motion.div>
      {eyebrow && (
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent/90">
          {eyebrow}
        </span>
      )}
    </div>
  );
}

export function OrbitalIllustration({ className = "h-24 w-24" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 120"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="orbGrad" x1="15" y1="15" x2="105" y2="105" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#A78BFA" />
          <stop offset="50%" stopColor="#7C3AED" />
          <stop offset="100%" stopColor="#6366F1" />
        </linearGradient>
      </defs>
      <circle cx="60" cy="60" r="46" stroke="url(#orbGrad)" strokeOpacity="0.25" strokeWidth="1.5" strokeDasharray="4 4" />
      <ellipse cx="60" cy="60" rx="48" ry="20" transform="rotate(-24 60 60)" stroke="url(#orbGrad)" strokeOpacity="0.45" strokeWidth="1.5" />
      <ellipse cx="60" cy="60" rx="48" ry="20" transform="rotate(24 60 60)" stroke="url(#orbGrad)" strokeOpacity="0.45" strokeWidth="1.5" />
      <circle cx="60" cy="60" r="18" fill="url(#orbGrad)" fillOpacity="0.18" stroke="url(#orbGrad)" strokeWidth="1.5" />
      <path d="M53 60l5 5 10-10" stroke="#A78BFA" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="96" cy="36" r="4" fill="#A78BFA" />
      <circle cx="24" cy="84" r="3.5" fill="#6366F1" />
      <circle cx="88" cy="92" r="3" fill="#EC4899" />
    </svg>
  );
}
