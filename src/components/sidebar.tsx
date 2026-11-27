"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  Calendar,
  FileText,
  Target,
  BarChart3,
  User,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Bot,
  Wrench,
  Menu,
  X,
  GraduationCap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { signOut } from "@/lib/auth-client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";

const navigationGroups = [
  {
    label: "Overview",
    items: [
      { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { name: "Calendar", href: "/calendar", icon: Calendar },
      { name: "Deadlines", href: "/deadlines", icon: Target },
    ],
  },
  {
    label: "Academics",
    items: [
      { name: "Notes", href: "/notes", icon: FileText },
      { name: "Progress", href: "/progress", icon: BarChart3 },
      { name: "Practice", href: "/practice", icon: GraduationCap },
    ],
  },
  {
    label: "Tools & AI",
    items: [
      { name: "AI Tutor", href: "/chat", icon: Bot },
      { name: "Utilities", href: "/utils", icon: Wrench },
    ],
  },
];

interface SidebarProps {
  user: {
    id: string;
    name: string;
    email: string;
    image?: string | null;
  };
}

export function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut({
      fetchOptions: {
        onSuccess: () => {
          router.push("/login");
          router.refresh();
        },
      },
    });
  };

  const initials = user.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const renderLinks = (isMobile = false) => (
    <>
      <nav className="flex-1 space-y-5 px-3 py-4 overflow-y-auto">
        {navigationGroups.map((group) => (
          <div key={group.label} className="space-y-1">
            {(isMobile || !collapsed) ? (
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
                {group.label}
              </p>
            ) : (
              <div className="mx-3 my-1.5 border-t border-sidebar-border/80" />
            )}
            {group.items.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  onClick={() => isMobile && setMobileOpen(false)}
                  title={!isMobile && collapsed ? item.name : undefined}
                  className={cn(
                    "group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-200 relative",
                    isActive
                      ? "bg-primary/15 text-primary shadow-[inset_0_0_0_1px_rgba(124,58,237,0.25)]"
                      : "text-sidebar-foreground hover:bg-glass-hover hover:text-foreground",
                  )}
                >
                  {isActive && (
                    <motion.div
                      layoutId={
                        isMobile ? "mobile-sidebar-active" : "sidebar-active"
                      }
                      className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full bg-primary"
                      transition={{ type: "spring", bounce: 0.2, duration: 0.55 }}
                    />
                  )}
                  <item.icon
                    className={cn(
                      "h-4.5 w-4.5 shrink-0 transition-transform duration-200 group-hover:scale-105",
                      isActive
                        ? "text-primary"
                        : "text-muted-foreground group-hover:text-foreground",
                    )}
                  />
                  {(isMobile || !collapsed) && (
                    <span className="whitespace-nowrap overflow-hidden">
                      {item.name}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-glass-hover cursor-pointer">
              <Avatar className="h-8 w-8">
                <AvatarImage src={user.image || undefined} alt={user.name} />
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              {(isMobile || !collapsed) && (
                <div className="flex-1 text-left min-w-0">
                  <p className="truncate font-medium text-foreground">
                    {user.name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {user.email}
                  </p>
                </div>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-56">
            <DropdownMenuLabel>My Account</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/profile" onClick={() => isMobile && setMobileOpen(false)}>
                <User className="mr-2 h-4 w-4" />
                Profile
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/settings" onClick={() => isMobile && setMobileOpen(false)}>
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleSignOut}
              className="text-destructive focus:text-destructive"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile Top Bar */}
      <div className="md:hidden sticky top-0 z-40 flex h-14 items-center justify-between border-b border-sidebar-border bg-sidebar/95 backdrop-blur-md px-4">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <Image
            src="/brand/logo.png"
            alt="StudySync"
            width={32}
            height={32}
            className="h-8 w-8 rounded-lg object-contain"
          />
          <span className="text-base font-bold gradient-text">StudySync</span>
        </Link>
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="p-2 rounded-lg border border-glass-border text-foreground hover:bg-glass-hover cursor-pointer"
          aria-label="Toggle navigation"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile Drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
              className="md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            />
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
              className="md:hidden fixed left-0 top-0 bottom-0 z-50 w-[260px] flex flex-col border-r border-sidebar-border bg-sidebar"
            >
              <div className="flex h-14 items-center justify-between border-b border-sidebar-border px-4">
                <div className="flex items-center gap-2.5">
                  <Image
                    src="/brand/logo.png"
                    alt="StudySync"
                    width={32}
                    height={32}
                    className="h-8 w-8 rounded-lg object-contain"
                  />
                  <span className="text-base font-bold gradient-text">
                    StudySync
                  </span>
                </div>
                <button
                  onClick={() => setMobileOpen(false)}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {renderLinks(true)}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Desktop Collapsible Sidebar */}
      <motion.aside
        initial={false}
        animate={{ width: collapsed ? 72 : 260 }}
        transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
        className="hidden md:flex sticky top-0 z-40 h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar"
      >
        <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-4">
          <Image
            src="/brand/logo.png"
            alt="StudySync"
            width={36}
            height={36}
            className="h-9 w-9 rounded-lg object-contain shrink-0"
          />
          {!collapsed && (
            <span className="text-lg font-bold gradient-text whitespace-nowrap overflow-hidden">
              StudySync
            </span>
          )}
        </div>

        {renderLinks(false)}

        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-20 flex h-6 w-6 items-center justify-center rounded-full border border-sidebar-border bg-sidebar text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          {collapsed ? (
            <ChevronRight className="h-3 w-3" />
          ) : (
            <ChevronLeft className="h-3 w-3" />
          )}
        </button>
      </motion.aside>
    </>
  );
}
