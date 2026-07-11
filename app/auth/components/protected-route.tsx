"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/hooks/use-auth";
import { isDev } from "@/lib/config/development";

export default function ProtectedRoute({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isAuthenticated, loading } = useAuth();
  const router = useRouter();
  const isDevMode = isDev();

  useEffect(() => {
    if (!loading) {
      if (isDevMode) {
        // In development mode, allow access
        return;
      }

      if (!isAuthenticated) {
        router.push("/auth");
      }
    }
  }, [isAuthenticated, loading, router, isDevMode]);

  // Show loading state while checking auth
  if (loading && !isDevMode) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 dark:border-white mx-auto"></div>
          <p className="mt-4 text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // In development mode, render children immediately
  if (isDevMode) {
    return <>{children}</>;
  }

  // Don't render anything if not authenticated
  if (!isAuthenticated) {
    return null;
  }

  return <>{children}</>;
}
