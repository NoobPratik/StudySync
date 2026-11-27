import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AI Tutor",
  description:
    "Chat with your AI tutor grounded in uploaded course notes and active modules.",
};

export default function ChatRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
