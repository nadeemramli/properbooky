import type { Metadata } from "next";
import AuthGuard from "@/components/auth/auth-guard";

export const metadata: Metadata = {
  title: "Authentication - ProperBooky",
  description: "Sign in to your ProperBooky account.",
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AuthGuard>{children}</AuthGuard>;
}
