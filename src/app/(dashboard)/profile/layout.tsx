import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Profile",
  description:
    "Manage your student account profile, college details, and avatar.",
};

export default function ProfileRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
