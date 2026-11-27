import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Calendar",
  description:
    "Manage weekly college timetables, lectures, labs, holidays, and exam dates.",
};

export default function CalendarRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
