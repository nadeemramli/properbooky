"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/lib/hooks/use-auth";

// Routes under /auth that must still render for an authenticated session.
// Clicking a password-reset link signs the user into a temporary recovery
// session, so redirecting "authenticated" users away makes the reset page
// impossible to reach.
const ALLOW_AUTHENTICATED = ["/auth/reset-password"];

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const allowAuthenticated = ALLOW_AUTHENTICATED.some((route) =>
    pathname?.startsWith(route)
  );

  useEffect(() => {
    if (!loading && isAuthenticated && !allowAuthenticated) {
      router.push("/library");
    }
  }, [isAuthenticated, loading, router, allowAuthenticated]);

  // Show loading state while checking auth
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 dark:border-white mx-auto"></div>
          <p className="mt-4 text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Don't render children if authenticated (except on recovery-session routes)
  if (isAuthenticated && !allowAuthenticated) {
    return null;
  }

  return <>{children}</>;
}
