import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Utilities",
  description:
    "Pomodoro focus timer and AI-assisted study brainstorm pad.",
};

export default function UtilitiesRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
