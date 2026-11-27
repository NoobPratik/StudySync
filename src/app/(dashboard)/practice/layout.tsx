import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Practice Studio",
  description:
    "Practice spaced-repetition AI flashcards and sample-paper mock exams by module.",
};

export default function PracticeRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
