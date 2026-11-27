import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard",
  description:
    "Overview of upcoming classes, active deadlines, syllabus progress, and AI study guidance.",
};

export default function DashboardRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
