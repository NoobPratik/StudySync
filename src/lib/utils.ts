import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(date));
}

export function formatDateTime(date: Date | string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

export function formatRelativeTime(date: Date | string): string {
  const now = new Date();
  const target = new Date(date);
  const diffMs = target.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return `${Math.abs(diffDays)} days ago`;
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays <= 7) return `In ${diffDays} days`;
  if (diffDays <= 30) return `In ${Math.ceil(diffDays / 7)} weeks`;
  return `In ${Math.ceil(diffDays / 30)} months`;
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function getDeadlineColor(dueAt: Date | string): string {
  const now = new Date();
  const due = new Date(dueAt);
  const diffDays = Math.ceil(
    (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (diffDays < 0) return "text-red-400";
  if (diffDays <= 1) return "text-red-400";
  if (diffDays <= 3) return "text-orange-400";
  if (diffDays <= 7) return "text-yellow-400";
  return "text-emerald-400";
}

export function getPriorityColor(priority: string): string {
  switch (priority) {
    case "URGENT":
      return "bg-red-500/20 text-red-400 border-red-500/30";
    case "HIGH":
      return "bg-orange-500/20 text-orange-400 border-orange-500/30";
    case "MEDIUM":
      return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
    case "LOW":
      return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
    default:
      return "bg-purple-500/20 text-purple-400 border-purple-500/30";
  }
}

export function getEventTypeColor(type: string): string {
  switch (type) {
    case "LECTURE":
      return "#7C3AED";
    case "EXAM":
      return "#EF4444";
    case "HOLIDAY":
      return "#10B981";
    case "LAB":
      return "#F59E0B";
    case "CUSTOM":
      return "#6366F1";
    default:
      return "#7C3AED";
  }
}

export function getStatusIcon(status: string): string {
  switch (status) {
    case "COMPLETED":
      return "✓";
    case "IN_PROGRESS":
      return "◔";
    case "PENDING":
      return "○";
    default:
      return "○";
  }
}

export function generateId(): string {
  return crypto.randomUUID();
}
