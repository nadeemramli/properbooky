"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
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
  BookOpen,
  MessageSquare,
  LifeBuoy,
  User,
  LogOut,
} from "lucide-react";
import { UploadBookDialog } from "../library/components/upload-book-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useAuth } from "@/lib/hooks/use-auth";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import type { Database } from "@/types/supabase";

interface SidebarProps {
  isCollapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ isCollapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [isBookshelvesOpen, setIsBookshelvesOpen] = useState(true);
  const [isStatusOpen, setIsStatusOpen] = useState(true);
  const [isTagsOpen, setIsTagsOpen] = useState(true);
  const { user, session } = useAuth();
  const [userTags, setUserTags] = useState<{ id: string; name: string }[]>([]);
  const supabase = createClientComponentClient<Database>();

  const currentView = searchParams.get("view");
  const currentStatus = searchParams.get("status");
  const currentTag = searchParams.get("tag");

  useEffect(() => {
    const fetchUserTags = async () => {
      if (user?.id) {
        const { data: tags, error } = await supabase
          .from("tags")
          .select("id, name")
          .eq("user_id", user.id)
          .order("name");

        if (!error && tags) {
          setUserTags(tags);
        }
      }
    };

    fetchUserTags();
  }, [user?.id, supabase]);

  return (
    <div
      className={cn(
        "group relative flex h-full flex-col border-r bg-[#030712] text-white transition-all duration-300",
        isCollapsed ? "w-[60px]" : "w-[240px]"
      )}
    >
      {/* Toggle Button */}
      <div className="absolute right-0 top-[64px] h-20 transition-transform">
        <div className="relative h-full">
          <Separator
            orientation="vertical"
            className="h-full w-[1px] bg-gray-800/50"
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggle}
            className={cn(
              "absolute -right-2 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border border-gray-800 bg-[#030712] p-0 hover:bg-gray-800",
              isCollapsed ? "rotate-0" : "rotate-180"
            )}
            type="button"
          >
            <ChevronRight className="h-3 w-3 text-gray-400" />
            <span className="sr-only">Toggle Sidebar</span>
          </Button>
        </div>
      </div>

      {/* Header */}
      <Link
        href="/"
        className={cn(
          "flex h-[64px] items-center border-b border-gray-800 px-6",
          isCollapsed ? "justify-center px-2" : "gap-3"
        )}
      >
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500">
            <BookOpen className="h-5 w-5 text-white" />
          </div>
          {!isCollapsed && (
            <span className="text-lg font-semibold tracking-tight">
              ProperBooky
            </span>
          )}
        </div>
      </Link>

      <div
        className={cn("flex-1 overflow-hidden", isCollapsed ? "px-2" : "px-4")}
      >
        {/* Search */}
        <div className="my-4 px-2">
          {isCollapsed ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsSearchExpanded(true)}
              type="button"
              className="w-full hover:bg-gray-800"
            >
              <Search className="h-4 w-4 text-gray-400" />
            </Button>
          ) : (
            <div className="flex w-full items-center gap-2 rounded-md border border-gray-800 bg-gray-900/50 px-3 py-2">
              <Search className="h-4 w-4 text-gray-400" />
              <Input
                type="text"
                placeholder="Search library..."
                className="h-auto border-0 bg-transparent p-0 text-sm text-gray-300 placeholder:text-gray-500 focus-visible:ring-0"
              />
            </div>
          )}
        </div>

        {/* Navigation */}
        <ScrollArea className="-mx-4 flex-1 py-2">
          <div className={cn("space-y-4 py-2", isCollapsed ? "px-2" : "px-6")}>
            {/* Library Section */}
            <div className="space-y-1">
              {!isCollapsed && (
                <h4 className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-gray-400">
                  Library
                </h4>
              )}
              <div className="space-y-1">
                <Collapsible
                  open={!isCollapsed && isBookshelvesOpen}
                  onOpenChange={setIsBookshelvesOpen}
                >
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="ghost"
                      className={cn(
                        "w-full hover:bg-gray-800",
                        isCollapsed ? "justify-center" : "justify-between"
                      )}
                      type="button"
                    >
                      <div
                        className={cn(
                          "flex items-center",
                          isCollapsed ? "justify-center" : "gap-3"
                        )}
                      >
                        <Library className="h-4 w-4 text-gray-400" />
                        {!isCollapsed && (
                          <span className="text-sm">Bookshelves</span>
                        )}
                      </div>
                      {!isCollapsed && (
                        <ChevronDown className="h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200" />
                      )}
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-1 pt-1">
                    <Link href="/library?view=overview" passHref>
                      <Button
                        variant={
                          currentView === "overview" ? "secondary" : "ghost"
                        }
                        className={cn(
                          "w-full justify-start pl-9 text-sm font-normal hover:bg-gray-800",
                          isCollapsed && "justify-center px-2",
                          currentView === "overview"
                            ? "bg-gray-800 text-white"
                            : "text-gray-400"
                        )}
                        type="button"
                      >
                        {!isCollapsed && <span>Overview</span>}
                      </Button>
                    </Link>
                    <Link href="/library?view=wishlist" passHref>
                      <Button
                        variant={
                          currentView === "wishlist" ? "secondary" : "ghost"
                        }
                        className={cn(
                          "w-full justify-start pl-9 text-sm font-normal hover:bg-gray-800",
                          isCollapsed && "justify-center px-2",
                          currentView === "wishlist"
                            ? "bg-gray-800 text-white"
                            : "text-gray-400"
                        )}
                        type="button"
                      >
                        {!isCollapsed && <span>Wishlist</span>}
                      </Button>
                    </Link>
                    <Link href="/library?view=tags" passHref>
                      <Button
                        variant={currentView === "tags" ? "secondary" : "ghost"}
                        className={cn(
                          "w-full justify-start pl-9 text-sm font-normal hover:bg-gray-800",
                          isCollapsed && "justify-center px-2",
                          currentView === "tags"
                            ? "bg-gray-800 text-white"
                            : "text-gray-400"
                        )}
                        type="button"
                      >
                        {!isCollapsed && <span>Tags</span>}
                      </Button>
                    </Link>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            </div>

            {/* Status Section */}
            <div className="space-y-1">
              {!isCollapsed && (
                <h4 className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-gray-400">
                  Reading
                </h4>
              )}
              <div className="space-y-1">
                <Collapsible
                  open={!isCollapsed && isStatusOpen}
                  onOpenChange={setIsStatusOpen}
                >
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="ghost"
                      className={cn(
                        "w-full hover:bg-gray-800",
                        isCollapsed ? "justify-center" : "justify-between"
                      )}
                      type="button"
                    >
                      <div
                        className={cn(
                          "flex items-center",
                          isCollapsed ? "justify-center" : "gap-3"
                        )}
                      >
                        <Book className="h-4 w-4 text-gray-400" />
                        {!isCollapsed && (
                          <span className="text-sm">Status</span>
                        )}
                      </div>
                      {!isCollapsed && (
                        <ChevronDown className="h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200" />
                      )}
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-1 pt-1">
                    <Link href="/library?status=unread" passHref>
                      <Button
                        variant="ghost"
                        className={cn(
                          "w-full justify-start pl-9 text-sm font-normal hover:bg-gray-800",
                          isCollapsed && "justify-center px-2",
                          currentStatus === "unread"
                            ? "bg-gray-800 text-white"
                            : "text-gray-400"
                        )}
                        type="button"
                      >
                        {!isCollapsed && <span>Unread</span>}
                      </Button>
                    </Link>
                    <Link href="/library?status=reading" passHref>
                      <Button
                        variant="ghost"
                        className={cn(
                          "w-full justify-start pl-9 text-sm font-normal hover:bg-gray-800",
                          isCollapsed && "justify-center px-2",
                          currentStatus === "reading"
                            ? "bg-gray-800 text-white"
                            : "text-gray-400"
                        )}
                        type="button"
                      >
                        {!isCollapsed && <span>Reading</span>}
                      </Button>
                    </Link>
                    <Link href="/library?status=completed" passHref>
                      <Button
                        variant="ghost"
                        className={cn(
                          "w-full justify-start pl-9 text-sm font-normal hover:bg-gray-800",
                          isCollapsed && "justify-center px-2",
                          currentStatus === "completed"
                            ? "bg-gray-800 text-white"
                            : "text-gray-400"
                        )}
                        type="button"
                      >
                        {!isCollapsed && <span>Completed</span>}
                      </Button>
                    </Link>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            </div>

            {/* Tags Section */}
            <div className="space-y-1">
              {!isCollapsed && (
                <div className="flex items-center justify-between px-2">
                  <h4 className="text-xs font-medium uppercase tracking-wider text-gray-400">
                    Tags
                  </h4>
                </div>
              )}
              <div className="space-y-1 mt-1">
                {userTags.map((tag) => (
                  <Link
                    key={tag.id}
                    href={`/library?tag=${encodeURIComponent(
                      tag.name.toLowerCase()
                    )}`}
                    passHref
                  >
                    <Button
                      variant="ghost"
                      className={cn(
                        "w-full justify-start pl-4 text-sm font-normal hover:bg-gray-800",
                        isCollapsed && "justify-center px-2",
                        currentTag === tag.name.toLowerCase()
                          ? "bg-gray-800 text-white"
                          : "text-gray-400"
                      )}
                      type="button"
                    >
                      <Tag className="mr-2 h-4 w-4 text-gray-400" />
                      {!isCollapsed && <span>{tag.name}</span>}
                    </Button>
                  </Link>
                ))}
                {userTags.length === 0 && !isCollapsed && (
                  <p className="text-xs text-gray-500 px-4">
                    No tags created yet
                  </p>
                )}
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>

      {/* Support and User Profile */}
      <div className="mt-auto border-t border-gray-800">
        <div className="px-4 py-2">
          <div className="grid gap-1">
            <Link href="/support" passHref>
              <Button
                variant="ghost"
                className={cn(
                  "w-full justify-start text-xs font-normal text-gray-400 hover:bg-gray-800 h-7",
                  isCollapsed && "justify-center px-2"
                )}
                type="button"
              >
                {!isCollapsed && <span>Support</span>}
              </Button>
            </Link>
            <Link href="/feedback" passHref>
              <Button
                variant="ghost"
                className={cn(
                  "w-full justify-start text-xs font-normal text-gray-400 hover:bg-gray-800 h-7",
                  isCollapsed && "justify-center px-2"
                )}
                type="button"
              >
                {!isCollapsed && <span>Feedback</span>}
              </Button>
            </Link>
          </div>
        </div>

        {/* User Profile */}
        <div className="border-t border-gray-800">
          <div
            className={cn(
              "flex items-center gap-1 p-3",
              isCollapsed ? "justify-center" : "justify-between"
            )}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Avatar className="h-7 w-7 border border-gray-800">
                <AvatarImage src={user?.user_metadata?.["avatar_url"] || ""} />
                <AvatarFallback className="bg-gray-900 text-gray-400 text-xs">
                  {user?.email?.[0]?.toUpperCase() || "U"}
                </AvatarFallback>
              </Avatar>
              {!isCollapsed && (
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-medium truncate">
                    {user?.user_metadata?.["full_name"] ||
                      user?.email?.split("@")[0] ||
                      "User"}
                  </span>
                  <span className="text-[11px] text-gray-400 truncate">
                    {user?.email || ""}
                  </span>
                </div>
              )}
            </div>
            {!isCollapsed && (
              <Link href="/preferences" passHref>
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  className="h-6 w-6 shrink-0 hover:bg-gray-800"
                >
                  <Settings className="h-3.5 w-3.5 text-gray-400" />
                  <span className="sr-only">Settings</span>
                </Button>
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
