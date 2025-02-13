"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  BookOpen,
  Calendar,
  Clock,
  FileText,
  Tag,
  Type,
  User,
  Menu,
  Plus,
} from "lucide-react";
import { useBooks } from "@/lib/hooks/use-books";
import { useToast } from "@/components/ui/use-toast";
import type { Book, Bookmark } from "@/types/book";

interface BookProfileProps {
  collapsed: boolean;
}

export function BookProfile({ collapsed }: BookProfileProps) {
  const { bookId } = useParams();
  const { getBook, updateBook } = useBooks();
  const { toast } = useToast();
  const [book, setBook] = useState<Book | null>(null);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newBookmark, setNewBookmark] = useState({
    title: "",
    page: 1,
    content: "",
  });

  useEffect(() => {
    async function loadBook() {
      try {
        const bookData = await getBook(bookId as string);
        setBook(bookData);
        setBookmarks(bookData.metadata?.bookmarks || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load book");
      } finally {
        setLoading(false);
      }
    }

    loadBook();
  }, [bookId, getBook]);

  const handleAddBookmark = async () => {
    if (!book) return;

    try {
      const bookmark: Bookmark = {
        id: crypto.randomUUID(),
        book_id: book.id,
        user_id: "current-user", // TODO: Get from auth context
        page: newBookmark.page,
        title: newBookmark.title,
        content: newBookmark.content,
        created_at: new Date().toISOString(),
      };

      const updatedBookmarks = [...bookmarks, bookmark];

      await updateBook(book.id, {
        metadata: {
          ...book.metadata,
          bookmarks: updatedBookmarks,
        },
      });

      setBookmarks(updatedBookmarks);
      setNewBookmark({ title: "", page: 1, content: "" });

      toast({
        title: "Success",
        description: "Bookmark added successfully",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to add bookmark",
      });
    }
  };

  if (collapsed) {
    return (
      <div className="h-full border-l">
        <div className="flex h-14 items-center justify-center border-b">
          <Menu className="h-6 w-6" />
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-full border-l">
        <div className="flex h-14 items-center px-4 border-b">
          <h2 className="font-semibold">Loading...</h2>
        </div>
      </div>
    );
  }

  if (error || !book) {
    return (
      <div className="h-full border-l">
        <div className="flex h-14 items-center px-4 border-b">
          <h2 className="font-semibold text-destructive">
            {error || "Book not found"}
          </h2>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full border-l">
      <div className="flex h-14 items-center px-4 border-b">
        <h2 className="font-semibold">Book Info</h2>
      </div>

      <ScrollArea className="h-[calc(100vh-3.5rem)]">
        <div className="p-4">
          <div className="space-y-4">
            {/* Book Cover and Basic Info */}
            <div className="flex gap-4">
              <div className="relative aspect-[3/4] w-24 overflow-hidden rounded-lg">
                {book.cover_url ? (
                  <Image
                    src={book.cover_url}
                    alt={book.title}
                    fill
                    className="object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center bg-muted">
                    <BookOpen className="h-8 w-8 text-muted-foreground" />
                  </div>
                )}
              </div>
              <div className="flex-1 space-y-1">
                <h3 className="font-semibold">{book.title}</h3>
                {book.author && (
                  <p className="text-sm text-muted-foreground">{book.author}</p>
                )}
              </div>
            </div>

            <Separator />

            {/* Reading Progress */}
            {book.progress !== undefined && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Reading Progress</span>
                  <span>{book.progress}%</span>
                </div>
                <Progress value={book.progress} />
              </div>
            )}

            <Separator />

            {/* Tabs */}
            <Tabs defaultValue="bookmarks">
              <TabsList className="w-full">
                <TabsTrigger value="bookmarks" className="flex-1">
                  Bookmarks
                </TabsTrigger>
                <TabsTrigger value="notes" className="flex-1">
                  Notes
                </TabsTrigger>
              </TabsList>

              <TabsContent value="bookmarks" className="mt-4 space-y-4">
                {/* Add Bookmark Form */}
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Title</Label>
                    <Input
                      value={newBookmark.title}
                      onChange={(e) =>
                        setNewBookmark({
                          ...newBookmark,
                          title: e.target.value,
                        })
                      }
                      placeholder="Bookmark title"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Page</Label>
                    <Input
                      type="number"
                      value={newBookmark.page}
                      onChange={(e) =>
                        setNewBookmark({
                          ...newBookmark,
                          page: parseInt(e.target.value),
                        })
                      }
                      placeholder="Page number"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Content</Label>
                    <Input
                      value={newBookmark.content}
                      onChange={(e) =>
                        setNewBookmark({
                          ...newBookmark,
                          content: e.target.value,
                        })
                      }
                      placeholder="Optional content or note"
                    />
                  </div>
                  <Button
                    className="w-full"
                    onClick={handleAddBookmark}
                    disabled={!newBookmark.title || !newBookmark.page}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Bookmark
                  </Button>
                </div>

                <Separator />

                {/* Bookmarks List */}
                <div className="space-y-2">
                  {bookmarks.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center">
                      No bookmarks yet
                    </p>
                  ) : (
                    bookmarks.map((bookmark) => (
                      <Button
                        key={bookmark.id}
                        variant="ghost"
                        className="w-full justify-start"
                        onClick={() => {
                          // TODO: Navigate to bookmarked page
                        }}
                      >
                        <div className="flex flex-col items-start gap-1">
                          <span className="font-medium">{bookmark.title}</span>
                          <span className="text-sm text-muted-foreground">
                            Page {bookmark.page}
                          </span>
                        </div>
                      </Button>
                    ))
                  )}
                </div>
              </TabsContent>

              <TabsContent value="notes" className="mt-4">
                <p className="text-sm text-muted-foreground text-center">
                  Notes feature coming soon...
                </p>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
