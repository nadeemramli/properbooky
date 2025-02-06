"use client";

import { useState } from "react";
import { BookGrid } from "./components/book-grid";
import { BookList } from "./components/book-list";
import { BookFilters } from "./components/book-filters";
import { UploadBookDialog } from "./components/upload-book-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LayoutGrid, List, Search } from "lucide-react";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { useSearchParams } from "next/navigation";

type ViewMode = "grid" | "list";

export default function LibraryPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 500);
  const searchParams = useSearchParams();
  const currentView = searchParams.get("view");
  const currentStatus = searchParams.get("status");

  return (
    <div className="container py-6 space-y-6">
      <div className="flex flex-col h-full">
        <div className="flex-none space-y-4 p-4 md:p-8 pt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-3xl font-bold tracking-tight">Library</h2>
            <div className="flex items-center gap-2">
              <UploadBookDialog />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex-1 flex items-center gap-2">
              <div className="relative flex-1 max-w-xl">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search books..."
                  className="pl-8"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2 border rounded-md p-1">
                <Button
                  variant={viewMode === "grid" ? "secondary" : "ghost"}
                  size="icon"
                  onClick={() => setViewMode("grid")}
                >
                  <LayoutGrid className="h-4 w-4" />
                </Button>
                <Button
                  variant={viewMode === "list" ? "secondary" : "ghost"}
                  size="icon"
                  onClick={() => setViewMode("list")}
                >
                  <List className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 p-4 md:px-8">
          <div className="flex h-full gap-8">
            <BookFilters className="w-64 flex-none" />
            <div className="flex-1 min-h-0 overflow-auto">
              {currentView === "tags" ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {/* TODO: Implement tag management UI */}
                  <p>Tag management coming soon...</p>
                </div>
              ) : viewMode === "grid" ? (
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
      </div>
    </div>
  );
}
