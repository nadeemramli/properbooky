"use client";

import { useState } from "react";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BookOpen, MoreVertical, Trash2, Edit } from "lucide-react";
import { BookProfileDialog } from "./book-profile-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Book } from "@/types/book";
import { useBooks } from "@/lib/hooks/use-books";
import { useToast } from "@/components/ui/use-toast";

interface BookListProps {
  searchQuery?: string;
  view: string | null;
  status: string | null;
}

export function BookList({ searchQuery, view, status }: BookListProps) {
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const { books, loading, error, deleteBook, updateBook } =
    useBooks(searchQuery);
  const { toast } = useToast();

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
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[300px]">Book</TableHead>
              <TableHead>Author</TableHead>
              <TableHead>Format</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Progress</TableHead>
              <TableHead>Added</TableHead>
              <TableHead>Last Read</TableHead>
              <TableHead className="w-[70px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredBooks.map((book) => (
              <TableRow key={book.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="relative h-16 w-12 overflow-hidden rounded">
                      {book.cover_url ? (
                        <Image
                          src={book.cover_url}
                          alt={book.title}
                          fill
                          className="object-cover"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center bg-muted">
                          <BookOpen className="h-6 w-6 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    <Button
                      variant="link"
                      className="p-0 h-auto font-medium"
                      onClick={() => setSelectedBook(book)}
                    >
                      {book.title}
                    </Button>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {book.author}
                </TableCell>
                <TableCell>
                  {book.format && (
                    <Badge variant="secondary">
                      {book.format.toUpperCase()}
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
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
                </TableCell>
                <TableCell>
                  {book.progress !== undefined && (
                    <div className="flex items-center gap-2">
                      <BookOpen className="h-4 w-4" />
                      <span className="text-muted-foreground">
                        {book.progress}%
                      </span>
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(book.created_at).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {book.last_read
                    ? new Date(book.last_read).toLocaleDateString()
                    : "-"}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
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
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <BookProfileDialog
        book={selectedBook}
        open={!!selectedBook}
        onOpenChange={(open) => !open && setSelectedBook(null)}
      />
    </>
  );
}
