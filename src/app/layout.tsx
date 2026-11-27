import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

function getMetadataBase(): URL {
  try {
    return new URL(process.env.BETTER_AUTH_URL || "http://localhost:3000");
  } catch {
    return new URL("http://localhost:3000");
  }
}

export const metadata: Metadata = {
  metadataBase: getMetadataBase(),
  applicationName: "StudySync",
  title: {
    default: "StudySync — Your AI Study Assistant",
    template: "%s | StudySync",
  },
  description:
    "Manage your college life with an AI-powered study assistant. Track timetables, deadlines, notes, flashcards, mock exams, progress, and focus sessions.",
  keywords: [
    "StudySync",
    "AI study assistant",
    "college planner",
    "timetable manager",
    "flashcards",
    "mock exams",
    "syllabus tracker",
  ],
  openGraph: {
    type: "website",
    siteName: "StudySync",
    title: "StudySync — Your AI Study Assistant",
    description:
      "AI-powered academic command center for schedules, notes, flashcards, mock exams, and deadline tracking.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "StudySync — AI Study Assistant",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "StudySync — Your AI Study Assistant",
    description:
      "AI-powered academic command center for schedules, notes, flashcards, mock exams, and deadline tracking.",
    images: ["/og-image.png"],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "StudySync",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#7C3AED",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col noise-overlay">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
