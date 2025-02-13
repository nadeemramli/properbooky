"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useBooks } from "@/lib/hooks/use-books";
import { PDFReader } from "../../components/reader/PDFReader";
import { EPUBReader } from "../../components/reader/EPUBReader";
import { Loader2 } from "lucide-react";
import type { Book } from "@/types/book";

export default function ReaderPage() {
  const { bookId } = useParams();
  const { getBook } = useBooks();
  const [book, setBook] = useState<Book | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadBook() {
      try {
        const bookData = await getBook(bookId as string);
        setBook(bookData);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load book");
      } finally {
        setLoading(false);
      }
    }

    loadBook();
  }, [bookId, getBook]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (error || !book) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-destructive">{error || "Book not found"}</p>
      </div>
    );
  }

  return (
    <div className="h-full">
      {book.format === "pdf" ? (
        <PDFReader book={book} />
      ) : book.format === "epub" ? (
        <EPUBReader book={book} />
      ) : (
        <div className="h-full flex items-center justify-center">
          <p className="text-destructive">Unsupported format: {book.format}</p>
        </div>
      )}
    </div>
  );
}
