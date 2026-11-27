"use client";

import { motion } from "framer-motion";
import { PomodoroWidget } from "@/components/pomodoro-widget";

export default function PomodoroPage() {
  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1 className="text-2xl sm:text-3xl font-bold">
          Pomodoro <span className="gradient-text">Focus Engine</span>
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Deep work sessions tagged by subject (also available inside Study
          Utilities)
        </p>
      </motion.div>
      <PomodoroWidget />
    </div>
  );
}
