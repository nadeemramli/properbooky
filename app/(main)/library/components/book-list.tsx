"use client";

import { useState } from "react";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BookOpen, MoreVertical } from "lucide-react";
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
import type { Book, BookMetadata } from "@/types/book";

interface BookListProps {
  searchQuery?: string;
  view: string | null;
  status: string | null;
}

// Helper function to create a book with default values
const createMockBook = (overrides: Partial<Book>): Book => {
  const defaultBook: Book = {
    id: "",
    title: "",
    author: null,
    cover_url: "/placeholder-book.jpg",
    file_url: "",
    format: "pdf",
    status: "unread",
    progress: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_read: null,
    user_id: "user123",
    metadata: {
      publisher: "",
      published_date: "",
      language: "en",
      pages: 0,
      isbn: "",
      description: "",
    },
    priority_score: 0,
  };

  return { ...defaultBook, ...overrides };
};

// Mock data with type-safe creation
const mockBooks: Book[] = [
  createMockBook({
    id: "1",
    title: "The Pragmatic Programmer",
    author: "David Thomas, Andrew Hunt",
    file_url: "/books/pragmatic-programmer.pdf",
    format: "epub",
    status: "reading",
    last_read: new Date().toISOString(),
    metadata: {
      publisher: "Addison-Wesley",
      published_date: "2019-09-13",
      language: "en",
      pages: 352,
      isbn: "978-0135957059",
      description: "The Pragmatic Programmer: Your Journey to Mastery",
    },
  }),
  createMockBook({
    id: "2",
    title: "Clean Code",
    author: "Robert C. Martin",
    file_url: "/books/clean-code.pdf",
    format: "pdf",
    status: "completed",
    progress: 100,
    created_at: "2024-01-10",
    updated_at: "2024-01-14",
    last_read: "2024-01-14",
    metadata: {
      publisher: "Prentice Hall",
      published_date: "2008-08-01",
      language: "English",
      pages: 464,
      isbn: "9780132350884",
      description:
        "Even bad code can function. But if code isn't clean, it can bring a development organization to its knees. Every year, countless hours and significant resources are lost because of poorly written code. But it doesn't have to be that way.",
    },
    priority_score: 1,
  }),
];

export function BookList({ searchQuery, view, status }: BookListProps) {
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);

  // Filter books based on search query
  const filteredBooks = mockBooks.filter((book) => {
    // Filter by search query
    if (
      searchQuery &&
      !book.title.toLowerCase().includes(searchQuery.toLowerCase())
    ) {
      return false;
    }

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
                      <Image
                        src={book.cover_url || "/placeholder-book.jpg"}
                        alt={book.title}
                        fill
                        className="object-cover"
                      />
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
                  <Badge variant="secondary">{book.format.toUpperCase()}</Badge>
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
                  {book.created_at}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {book.last_read}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem>Edit</DropdownMenuItem>
                      <DropdownMenuItem>Delete</DropdownMenuItem>
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
