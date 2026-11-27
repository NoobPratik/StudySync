import type { Metadata } from "next";
import { isGoogleOAuthEnabled } from "@/lib/auth";
import { LoginClient } from "@/components/auth/login-client";

export const metadata: Metadata = {
  title: "Sign In",
  description: "Sign in to your StudySync academic workspace.",
};

export default function LoginPage() {
  return <LoginClient googleEnabled={isGoogleOAuthEnabled} />;
}
