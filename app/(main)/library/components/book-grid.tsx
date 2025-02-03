"use client";

import { useState } from "react";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BookOpen, MoreVertical, Trash2, Edit } from "lucide-react";
import { BookProfileDialog } from "./book-profile-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useBooks } from "@/lib/hooks/use-books";
import { Book } from "@/types/book";
import { useToast } from "@/components/ui/use-toast";

interface BookGridProps {
  searchQuery?: string;
}

export function BookGrid({ searchQuery }: BookGridProps) {
  const { books, loading, error, deleteBook, updateBook } =
    useBooks(searchQuery);
  const { toast } = useToast();
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);

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
    return <div>Error loading books: {error}</div>;
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      {books.map((book) => (
        <Card key={book.id} className="overflow-hidden">
          <CardContent className="p-0">
            <div className="relative aspect-[3/4] bg-muted">
              {book.cover_url ? (
                <Image
                  src={book.cover_url}
                  alt={book.title}
                  fill
                  className="object-cover"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <BookOpen className="h-12 w-12 text-muted-foreground" />
                </div>
              )}
            </div>
            <div className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold leading-none truncate">
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
                    <Button variant="ghost" size="icon">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setSelectedBook(book)}>
                      <Edit className="mr-2 h-4 w-4" />
                      View Details
                    </DropdownMenuItem>
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
              <div className="mt-2">
                <Badge
                  variant={
                    book.status === "completed"
                      ? "default"
                      : book.status === "reading"
                      ? "secondary"
                      : "outline"
                  }
                >
                  {book.status}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
      {selectedBook && (
        <BookProfileDialog
          book={selectedBook}
          onClose={() => setSelectedBook(null)}
        />
      )}
    </div>
  );
}
