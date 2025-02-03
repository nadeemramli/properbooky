"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Book,
  ChevronDown,
  ChevronRight,
  Home,
  Library,
  Search,
  Settings,
  Tag,
  Upload,
} from "lucide-react";
import { UploadBookDialog } from "../library/components/upload-book-dialog";

interface SidebarProps {
  isCollapsed: boolean;
}

export function Sidebar({ isCollapsed }: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);

  const currentView = searchParams.get("view");
  const currentStatus = searchParams.get("status");

  return (
    <div className="flex h-full flex-col gap-2">
      {/* Header */}
      <div className="flex h-[60px] items-center justify-between px-4 py-2">
        <Link href="/" className="flex items-center gap-2">
          {!isCollapsed && (
            <span className="text-xl font-bold">ProperBooky</span>
          )}
        </Link>
      </div>

      <div className="flex flex-1 flex-col gap-4 px-4">
        {/* Search */}
        <div className="flex items-center gap-2">
          {isCollapsed ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsSearchExpanded(true)}
            >
              <Search className="h-4 w-4" />
            </Button>
          ) : (
            <div className="flex w-full items-center gap-2 rounded-md border px-3 py-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search library..."
                className="h-auto border-0 p-0 focus-visible:ring-0"
              />
            </div>
          )}
        </div>

        {/* Navigation */}
        <ScrollArea className="flex-1">
          <div className="space-y-4">
            <nav className="grid gap-1">
              <Link href="/" passHref>
                <Button
                  variant={pathname === "/" ? "secondary" : "ghost"}
                  className={cn(
                    "w-full justify-start",
                    isCollapsed && "justify-center"
                  )}
                >
                  <Home className="mr-2 h-4 w-4" />
                  {!isCollapsed && <span>Home</span>}
                </Button>
              </Link>
            </nav>

            {/* Library Section */}
            <div className="py-2">
              <h4
                className={cn(
                  "mb-1 text-sm font-semibold",
                  isCollapsed && "sr-only"
                )}
              >
                Library
              </h4>
              <Collapsible defaultOpen>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="w-full justify-between">
                    <div className="flex items-center">
                      <Library className="mr-2 h-4 w-4" />
                      {!isCollapsed && <span>Bookshelves</span>}
                    </div>
                    {!isCollapsed && <ChevronDown className="h-4 w-4" />}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-1">
                  {[
                    { name: "Overview", value: "overview" },
                    { name: "Wishlist", value: "wishlist" },
                    { name: "Tags", value: "tags" },
                  ].map((item) => (
                    <Link
                      key={item.value}
                      href={`/library?view=${item.value}`}
                      passHref
                    >
                      <Button
                        variant={
                          currentView === item.value ? "secondary" : "ghost"
                        }
                        className={cn(
                          "w-full justify-start pl-8",
                          isCollapsed && "justify-center pl-2"
                        )}
                      >
                        <ChevronRight className="mr-2 h-4 w-4" />
                        {!isCollapsed && <span>{item.name}</span>}
                      </Button>
                    </Link>
                  ))}
                </CollapsibleContent>
              </Collapsible>

              {/* Status Section */}
              <Collapsible defaultOpen className="mt-2">
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="w-full justify-between">
                    <div className="flex items-center">
                      <Book className="mr-2 h-4 w-4" />
                      {!isCollapsed && <span>Status</span>}
                    </div>
                    {!isCollapsed && <ChevronDown className="h-4 w-4" />}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-1">
                  {[
                    { name: "Unread", value: "unread" },
                    { name: "Reading", value: "reading" },
                    { name: "Completed", value: "completed" },
                  ].map((status) => (
                    <Link
                      key={status.value}
                      href={`/library?status=${status.value}`}
                      passHref
                    >
                      <Button
                        variant={
                          currentStatus === status.value ? "secondary" : "ghost"
                        }
                        className={cn(
                          "w-full justify-start pl-8",
                          isCollapsed && "justify-center pl-2"
                        )}
                      >
                        <ChevronRight className="mr-2 h-4 w-4" />
                        {!isCollapsed && <span>{status.name}</span>}
                      </Button>
                    </Link>
                  ))}
                </CollapsibleContent>
              </Collapsible>

              {/* Tags Section */}
              <div className="mt-4">
                <h4
                  className={cn(
                    "mb-1 text-sm font-semibold",
                    isCollapsed && "sr-only"
                  )}
                >
                  Tags
                </h4>
                <div className="space-y-1">
                  <Link href="/library?view=tags" passHref>
                    <Button
                      variant={currentView === "tags" ? "secondary" : "ghost"}
                      className={cn(
                        "w-full justify-start",
                        isCollapsed && "justify-center"
                      )}
                    >
                      <Tag className="mr-2 h-4 w-4" />
                      {!isCollapsed && <span>Manage Tags</span>}
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>

      {/* Footer */}
      <div className="mt-auto p-4 border-t">
        <div className="flex flex-col gap-2">
          <UploadBookDialog />
          <Link href="/preferences" passHref>
            <Button
              variant="outline"
              className={cn("justify-start", isCollapsed && "justify-center")}
            >
              <Settings className="mr-2 h-4 w-4" />
              {!isCollapsed && <span>Preferences</span>}
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
