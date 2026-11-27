import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Settings",
  description:
    "Configure AI providers, push notifications, PWA installation, and app preferences.",
};

export default function SettingsRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
