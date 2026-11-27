import type { Metadata } from "next";
import { isGoogleOAuthEnabled } from "@/lib/auth";
import { RegisterClient } from "@/components/auth/register-client";

export const metadata: Metadata = {
  title: "Create Account",
  description:
    "Create a free StudySync account to manage timetables, notes, flashcards, and deadlines.",
};

export default function RegisterPage() {
  return <RegisterClient googleEnabled={isGoogleOAuthEnabled} />;
}
