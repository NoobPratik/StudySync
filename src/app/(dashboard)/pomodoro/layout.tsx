import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Focus Timer",
  description:
    "Customizable Pomodoro focus timer with subject logging and session streaks.",
};

export default function PomodoroRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
