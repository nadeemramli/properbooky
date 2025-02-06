"use client";

import AuthGuard from "@/components/auth/auth-guard";

export default function ClientAuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AuthGuard>{children}</AuthGuard>;
}
