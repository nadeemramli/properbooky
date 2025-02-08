"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  BookOpen,
  MoreVertical,
  Trash2,
  Edit,
  ExternalLink,
  Eye,
} from "lucide-react";
import { BookProfileDialog } from "./book-profile-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useBooks } from "@/lib/hooks/use-books";
import type { Book } from "@/types/book";
import { useToast } from "@/components/ui/use-toast";
import { BOOK_STATUS_VARIANTS } from "@/lib/constants";

interface BookGridProps {
  searchQuery?: string;
  view: string | null;
  status: string | null;
}

export function BookGrid({ searchQuery, view, status }: BookGridProps) {
  const { books, loading, error, deleteBook, updateBook } =
    useBooks(searchQuery);
  const { toast } = useToast();
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);

  // Filter books based on view and status
  const filteredBooks = books.filter((book) => {
    // Filter by status if specified
    if (status && book.status !== status) {
      return false;
    }

    // Filter by view (tags view is handled by parent component)
    if (view === "recent") {
      // Show books added in the last 7 days
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      return new Date(book.created_at) > sevenDaysAgo;
    }

    return true;
  });

  const handleDelete = async (id: string) => {
    try {
      await deleteBook(id);
      toast({
        title: "Book deleted",
        description: "The book has been removed from your library.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete the book. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleStatusUpdate = async (id: string, status: Book["status"]) => {
    try {
      await updateBook(id, { status });
      toast({
        title: "Status updated",
        description: "Book status has been updated successfully.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update book status. Please try again.",
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return <div>Loading your library...</div>;
  }

  if (error) {
    return <div>Error loading books: {error.message}</div>;
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      {filteredBooks.map((book) => (
        <Card key={book.id} className="overflow-hidden group">
          <CardContent className="p-0">
            <div
              className="relative aspect-[3/4] bg-muted cursor-pointer group"
              onClick={() => setSelectedBook(book)}
            >
              {book.cover_url ? (
                <Image
                  src={book.cover_url}
                  alt={book.title}
                  fill
                  className="object-cover transition-transform group-hover:scale-105"
                  priority={false}
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-gray-900 to-gray-800">
                  <div className="text-center p-4">
                    <BookOpen className="h-12 w-12 text-gray-400 mx-auto mb-2" />
                    <h4 className="text-sm font-medium text-gray-200 line-clamp-3">
                      {book.title}
                    </h4>
                  </div>
                </div>
              )}

              {/* Quick Actions Overlay */}
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                {book.file_url && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (book.file_url) {
                        window.open(book.file_url, "_blank");
                      }
                    }}
                  >
                    <Eye className="h-4 w-4 mr-1" />
                    Read
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedBook(book);
                  }}
                >
                  <Edit className="h-4 w-4 mr-1" />
                  Details
                </Button>
              </div>
            </div>

            <div className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold leading-none truncate mb-1">
                    {book.title}
                  </h3>
                  {book.author && (
                    <p className="text-sm text-muted-foreground truncate">
                      {book.author}
                    </p>
                  )}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    {book.file_url && (
                      <DropdownMenuItem asChild>
                        <Link
                          href={book.file_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Eye className="mr-2 h-4 w-4" />
                          Read Book
                        </Link>
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={() => setSelectedBook(book)}>
                      <Edit className="mr-2 h-4 w-4" />
                      View Details
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => handleStatusUpdate(book.id, "reading")}
                    >
                      <BookOpen className="mr-2 h-4 w-4" />
                      Mark as Reading
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleStatusUpdate(book.id, "completed")}
                    >
                      <BookOpen className="mr-2 h-4 w-4" />
                      Mark as Completed
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-red-600"
                      onClick={() => handleDelete(book.id)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge variant={BOOK_STATUS_VARIANTS[book.status]}>
                  {book.status}
                </Badge>
                <Badge variant="secondary">{book.format.toUpperCase()}</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}

      <BookProfileDialog
        book={selectedBook}
        open={!!selectedBook}
        onOpenChange={(open) => !open && setSelectedBook(null)}
      />
    </div>
  );
}
