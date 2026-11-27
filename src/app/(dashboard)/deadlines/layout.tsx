import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Deadlines",
  description:
    "Track upcoming assignments, quizzes, and exams or extract deadlines with AI.",
};

export default function DeadlinesRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
