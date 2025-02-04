"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/hooks/use-auth";

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && isAuthenticated) {
      router.push("/library");
    }
  }, [isAuthenticated, loading, router]);

  // Show loading state or nothing while checking auth
  if (loading || isAuthenticated) {
    return null;
  }

  return <>{children}</>;
}
