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

interface Book {
  id: string;
  title: string;
  cover_url: string;
  format: "epub" | "pdf";
  status: "unread" | "reading" | "completed";
  progress?: number;
  author?: string;
  added_date?: string;
  last_read?: string;
  metadata?: {
    publisher?: string;
    published_date?: string;
    language?: string;
    pages?: number;
    isbn?: string;
    description?: string;
  };
  highlights?: Array<{
    id: string;
    content: string;
    page: number;
    created_at: string;
    tags?: string[];
  }>;
}

interface BookListProps {
  searchQuery?: string;
}

// Mock data - replace with actual data from your API
const mockBooks: Book[] = [
  {
    id: "1",
    title: "The Pragmatic Programmer",
    cover_url: "/placeholder-book.jpg",
    format: "epub",
    status: "reading",
    progress: 45,
    author: "Dave Thomas, Andy Hunt",
    added_date: "2024-01-15",
    last_read: "2024-01-20",
    metadata: {
      publisher: "Addison-Wesley Professional",
      published_date: "2019-09-23",
      language: "English",
      pages: 352,
      isbn: "9780135957059",
      description:
        "The Pragmatic Programmer is one of those rare tech books you'll read, re-read, and read again over the years. Whether you're new to the field or an experienced practitioner, you'll come away with fresh insights each and every time.",
    },
    highlights: [
      {
        id: "h1",
        content:
          "You Should Care About Craftsmanship. We want to write code we're proud of.",
        page: 45,
        created_at: "2024-01-18",
        tags: ["craftsmanship", "principles"],
      },
      {
        id: "h2",
        content:
          "Don't Live with Broken Windows. Fix bad designs, wrong decisions, and poor code when you see them.",
        page: 78,
        created_at: "2024-01-19",
        tags: ["maintenance", "quality"],
      },
    ],
  },
  {
    id: "2",
    title: "Clean Code",
    cover_url: "/placeholder-book.jpg",
    format: "pdf",
    status: "completed",
    progress: 100,
    author: "Robert C. Martin",
    added_date: "2024-01-10",
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
    highlights: [
      {
        id: "h3",
        content:
          "Functions should do one thing. They should do it well. They should do it only.",
        page: 35,
        created_at: "2024-01-12",
        tags: ["functions", "principles"],
      },
    ],
  },
];

export function BookList({ searchQuery }: BookListProps) {
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);

  // Filter books based on search query
  const filteredBooks = mockBooks.filter((book) =>
    book.title.toLowerCase().includes(searchQuery?.toLowerCase() ?? "")
  );

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
                        src={book.cover_url}
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
                        ? "success"
                        : book.status === "reading"
                        ? "warning"
                        : "secondary"
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
                  {book.added_date}
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
