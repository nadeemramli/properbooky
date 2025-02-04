"use client";

import { useState } from "react";
import ProtectedRoute from "@/components/auth/protected-route";
import { Sidebar } from "./components/sidebar";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <ProtectedRoute>
      <div className="flex h-screen">
        <Sidebar isCollapsed={isCollapsed} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </ProtectedRoute>
  );
}
