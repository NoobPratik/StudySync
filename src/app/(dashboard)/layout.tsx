import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/lib/session";
import { Sidebar } from "@/components/sidebar";
import { BackgroundExtractionProvider } from "@/components/background-extraction-provider";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

function DashboardShellSkeleton() {
  return (
    <div className="flex min-h-screen bg-background bg-grid">
      <div className="w-[260px] border-r border-sidebar-border bg-sidebar p-4 space-y-4">
        <div className="h-9 w-36 rounded-lg shimmer" />
        <div className="space-y-2 pt-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-10 rounded-lg shimmer" />
          ))}
        </div>
      </div>
      <main className="flex-1 p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
        <div className="h-10 w-64 rounded-lg shimmer" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 rounded-xl shimmer" />
          ))}
        </div>
      </main>
    </div>
  );
}

async function AuthenticatedDashboardShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-background bg-grid relative overflow-x-clip">
      {/* Subtle Ambient Futuristic Aurora Glows */}
      <div
        className="pointer-events-none fixed top-[-140px] right-[-120px] h-[420px] w-[420px] rounded-full opacity-20 blur-[120px] bg-primary"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none fixed bottom-[-160px] left-[18%] h-[380px] w-[380px] rounded-full opacity-15 blur-[120px] bg-secondary"
        aria-hidden="true"
      />
      <Sidebar user={user} />
      <main className="flex-1 min-w-0">
        <BackgroundExtractionProvider>
          <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">{children}</div>
        </BackgroundExtractionProvider>
      </main>
    </div>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<DashboardShellSkeleton />}>
      <AuthenticatedDashboardShell>{children}</AuthenticatedDashboardShell>
    </Suspense>
  );
}
