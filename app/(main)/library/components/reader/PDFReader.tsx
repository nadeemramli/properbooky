"use client";

import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCw,
} from "lucide-react";
import { useBooks } from "@/lib/hooks/use-books";
import { useReader } from "@/lib/contexts/reader-context";
import { extractPDFTOC } from "@/lib/utils/toc-extractor";
import type { Book, TOCItem } from "@/types/book";

// Set up PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

interface PDFReaderProps {
  book: Book;
}

export function PDFReader({ book }: PDFReaderProps) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [toc, setToc] = useState<TOCItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { updateBook } = useBooks();
  const { currentPage, setCurrentPage } = useReader();

  useEffect(() => {
    async function loadTOC() {
      try {
        if (!book.file_url) {
          setError("Book file not found");
          return;
        }
        const extractedTOC = await extractPDFTOC(book.file_url);
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

  // Update reading progress when page changes
  useEffect(() => {
    if (numPages && currentPage) {
      const progress = Math.round((currentPage / numPages) * 100);
      updateBook(book.id, {
        progress,
        last_read: new Date().toISOString(),
      }).catch(console.error);
    }
  }, [currentPage, numPages, book.id, updateBook]);

  function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
    setNumPages(numPages);

    // If there's a stored progress, go to that page
    if (book.progress && book.progress > 0) {
      const targetPage = Math.round((book.progress / 100) * numPages);
      setCurrentPage(targetPage);
    }
  }

  function changePage(offset: number) {
    setCurrentPage((prevPageNumber) => {
      const newPage = prevPageNumber + offset;
      return numPages ? Math.min(Math.max(1, newPage), numPages) : 1;
    });
  }

  function goToPage(page: number) {
    if (page >= 1 && (!numPages || page <= numPages)) {
      setCurrentPage(page);
    }
  }

  function zoomIn() {
    setScale((prev) => Math.min(prev + 0.1, 3));
  }

  function zoomOut() {
    setScale((prev) => Math.max(prev - 0.1, 0.5));
  }

  function rotate() {
    setRotation((prev) => (prev + 90) % 360);
  }

  return (
    <div className="relative h-full" ref={containerRef}>
      {error ? (
        <div className="flex h-full items-center justify-center">
          <p className="text-destructive">{error}</p>
        </div>
      ) : (
        <>
          {/* Toolbar */}
          <div className="flex items-center justify-between border-b px-4 py-2">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => changePage(-1)}
                disabled={currentPage <= 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={numPages || 1}
                  value={currentPage}
                  onChange={(e) => goToPage(parseInt(e.target.value))}
                  className="w-16"
                />
                <span className="text-sm text-muted-foreground">
                  of {numPages || "--"}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => changePage(1)}
                disabled={numPages !== null && currentPage >= numPages}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={zoomOut}>
                <ZoomOut className="h-4 w-4" />
              </Button>
              <Slider
                value={[scale]}
                onValueChange={([value]) => value && setScale(value)}
                min={0.5}
                max={3}
                step={0.1}
                className="w-32"
              />
              <Button variant="ghost" size="icon" onClick={zoomIn}>
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={rotate}>
                <RotateCw className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* PDF Viewer */}
          <ScrollArea className="flex-1" ref={containerRef}>
            <div className="flex min-h-full items-start justify-center p-4">
              <Document
                file={book.file_url}
                onLoadSuccess={onDocumentLoadSuccess}
                onLoadError={(error) => setError(error.message)}
              >
                <Page
                  pageNumber={currentPage}
                  scale={scale}
                  rotate={rotation}
                  loading={
                    <div className="flex items-center justify-center p-8">
                      <p className="text-muted-foreground">Loading page...</p>
                    </div>
                  }
                />
              </Document>
            </div>
          </ScrollArea>
        </>
      )}
    </div>
  );
}
