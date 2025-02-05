"use client";

import { useState } from "react";
import ProtectedRoute from "@/app/auth/components/protected-route";
import { Sidebar } from "./components/sidebar";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const toggleSidebar = () => setIsCollapsed(!isCollapsed);

  return (
    <ProtectedRoute>
      <div className="flex h-screen">
        <Sidebar isCollapsed={isCollapsed} onToggle={toggleSidebar} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </ProtectedRoute>
  );
}
