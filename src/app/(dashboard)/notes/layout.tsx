import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Notes Vault",
  description:
    "Organize course notes by subject and module with automatic topic extraction.",
};

export default function NotesRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
