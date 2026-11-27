import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Syllabus Progress",
  description:
    "Track module topic completion and daily exam preparation pacing.",
};

export default function ProgressRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
