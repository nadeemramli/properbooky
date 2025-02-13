"use client";

import { useEffect, useRef, useState } from "react";
import { ReactReader } from "react-reader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useBooks } from "@/lib/hooks/use-books";
import { extractEPUBTOC } from "@/lib/utils/toc-extractor";
import type { Book, TOCItem } from "@/types/book";
import type { Location } from "epubjs";

interface EPUBReaderProps {
  book: Book;
}

export function EPUBReader({ book }: EPUBReaderProps) {
  const [location, setLocation] = useState<string | number>(
    book.progress ? `${book.progress}%` : "0"
  );
  const [totalPages, setTotalPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [toc, setToc] = useState<TOCItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const renditionRef = useRef<any>(null);
  const { updateBook } = useBooks();

  useEffect(() => {
    async function loadTOC() {
      try {
        if (!book.file_url) {
          setError("Book file not found");
          return;
        }
        const extractedTOC = await extractEPUBTOC(book.file_url);
        setToc(extractedTOC);

        // Update book metadata with TOC if it doesn't exist
        if (!book.metadata.toc) {
          await updateBook(book.id, {
            metadata: {
              ...book.metadata,
              toc: extractedTOC,
            },
          });
        }
      } catch (error) {
        console.error("Error loading TOC:", error);
        setError(
          error instanceof Error
            ? error.message
            : "Failed to load table of contents"
        );
      }
    }

    loadTOC();
  }, [book.file_url, book.id, book.metadata, updateBook]);

  const locationChanged = (epubcifi: string) => {
    setLocation(epubcifi);

    // Get current page and update progress
    if (renditionRef.current) {
      const currentLocation = renditionRef.current.location;
      if (currentLocation?.start) {
        const { displayed, total } = currentLocation.start;
        setCurrentPage(displayed.page);
        setTotalPages(total.pages);

        // Calculate and update progress
        const progress = Math.round((displayed.page / total.pages) * 100);
        updateBook(book.id, {
          progress,
          last_read: new Date().toISOString(),
        }).catch(console.error);
      }
    }
  };

  const changePage = (direction: "prev" | "next") => {
    if (renditionRef.current) {
      direction === "prev"
        ? renditionRef.current.prev()
        : renditionRef.current.next();
    }
  };

  const goToPage = (page: number) => {
    if (renditionRef.current && page >= 1 && page <= totalPages) {
      renditionRef.current.display(page);
    }
  };

  return (
    <div className="relative h-full">
      {error || !book.file_url ? (
        <div className="flex h-full items-center justify-center">
          <p className="text-destructive">
            {error || "Book file not available"}
          </p>
        </div>
      ) : (
        <>
          {/* Navigation controls */}
          <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-4 rounded-lg bg-background/80 p-2 shadow backdrop-blur">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => changePage("prev")}
              disabled={currentPage <= 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>

            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={totalPages}
                value={currentPage}
                onChange={(e) => setCurrentPage(parseInt(e.target.value))}
                className="w-16 text-center"
              />
              <span className="text-sm text-muted-foreground">
                of {totalPages}
              </span>
            </div>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => changePage("next")}
              disabled={currentPage >= totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {/* EPUB Reader */}
          <div style={{ height: "100%", position: "relative" }}>
            <ReactReader
              url={book.file_url}
              location={location}
              locationChanged={locationChanged}
              getRendition={(rendition) => {
                renditionRef.current = rendition;
              }}
              epubOptions={{
                flow: "scrolled",
                manager: "continuous",
              }}
              loadingView={
                <div className="flex h-full items-center justify-center">
                  <p className="text-muted-foreground">Loading book...</p>
                </div>
              }
            />
          </div>
        </>
      )}
    </div>
  );
}
