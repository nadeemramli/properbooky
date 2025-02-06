"use client";

import { useEffect, useState } from "react";
import { BookGrid } from "./components/book-grid";
import { BookList } from "./components/book-list";
import { BookFilters } from "./components/book-filters";
import { UploadBookDialog } from "./components/upload-book-dialog";
import { BulkUploadDialog } from "./components/bulk-upload-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LayoutGrid, List, Search } from "lucide-react";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { useSearchParams, useRouter, usePathname } from "next/navigation";

type ViewMode = "grid" | "list";

export default function LibraryPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Initialize view mode from URL or localStorage, default to grid
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window !== "undefined") {
      const savedView = localStorage.getItem("libraryViewMode");
      return (savedView as ViewMode) || "grid";
    }
    return "grid";
  });

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 500);

  const currentView = searchParams.get("view");
  const currentStatus = searchParams.get("status");

  // Persist view mode to localStorage and URL
  useEffect(() => {
    localStorage.setItem("libraryViewMode", viewMode);
    const params = new URLSearchParams(searchParams);
    params.set("view", viewMode);
    router.replace(`${pathname}?${params.toString()}`);
  }, [viewMode, pathname, router, searchParams]);

  // Update search params when search changes
  useEffect(() => {
    if (debouncedSearch) {
      const params = new URLSearchParams(searchParams);
      params.set("search", debouncedSearch);
      router.replace(`${pathname}?${params.toString()}`);
    } else {
      const params = new URLSearchParams(searchParams);
      params.delete("search");
      router.replace(`${pathname}?${params.toString()}`);
    }
  }, [debouncedSearch, pathname, router, searchParams]);

  return (
    <div className="container max-w-7xl mx-auto py-6 space-y-6">
      <div className="flex flex-col h-full">
        <div className="flex-none space-y-4 px-4 md:px-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <h2 className="text-3xl font-bold tracking-tight">Library</h2>
            <div className="flex items-center gap-2 shrink-0">
              <UploadBookDialog />
              <BulkUploadDialog />
            </div>
          </div>

          <div className="flex flex-col md:flex-row gap-4 items-start md:items-center">
            <div className="flex-1 flex items-center gap-2 min-w-0 w-full md:w-auto">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Search books..."
                  className="pl-8"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2 border rounded-md p-1 shrink-0">
                <Button
                  variant={viewMode === "grid" ? "secondary" : "ghost"}
                  size="icon"
                  onClick={() => setViewMode("grid")}
                  title="Grid view"
                >
                  <LayoutGrid className="h-4 w-4" />
                </Button>
                <Button
                  variant={viewMode === "list" ? "secondary" : "ghost"}
                  size="icon"
                  onClick={() => setViewMode("list")}
                  title="List view"
                >
                  <List className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="w-full md:w-auto shrink-0">
              <BookFilters />
            </div>
          </div>
        </div>

        <div className="flex-1 px-4 md:px-0 pb-4">
          {viewMode === "grid" ? (
            <BookGrid
              searchQuery={debouncedSearch}
              view={currentView}
              status={currentStatus}
            />
          ) : (
            <BookList
              searchQuery={debouncedSearch}
              view={currentView}
              status={currentStatus}
            />
          )}
        </div>
      </div>
    </div>
  );
}
