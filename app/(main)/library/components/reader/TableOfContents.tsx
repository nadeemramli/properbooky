"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { ChevronRight, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBooks } from "@/lib/hooks/use-books";
import { useReader } from "@/lib/contexts/reader-context";
import { extractTOC } from "@/lib/utils/toc-extractor";
import type { TOCItem } from "@/types/book";

interface TableOfContentsProps {
  collapsed: boolean;
}

export function TableOfContents({ collapsed }: TableOfContentsProps) {
  const { bookId } = useParams();
  const { getBook, updateBook } = useBooks();
  const { setCurrentPage } = useReader();
  const [toc, setToc] = useState<TOCItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeItem, setActiveItem] = useState<string | null>(null);

  useEffect(() => {
    async function loadTOC() {
      try {
        const book = await getBook(bookId as string);

        if (!book) {
          setError("Book not found");
          setLoading(false);
          return;
        }

        // If TOC exists in metadata, use it
        if (book.metadata.toc) {
          setToc(book.metadata.toc);
          setLoading(false);
          return;
        }

        // Check if file_url exists
        if (!book.file_url) {
          setError("Book file not found");
          setLoading(false);
          return;
        }

        // Check if format is valid
        if (!book.format) {
          setError("Invalid book format");
          setLoading(false);
          return;
        }

        // Otherwise, extract it
        const extractedTOC = await extractTOC(book.file_url, book.format);
        setToc(extractedTOC);

        // Save to metadata
        await updateBook(book.id, {
          metadata: {
            ...book.metadata,
            toc: extractedTOC,
          },
        });

        setLoading(false);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load table of contents"
        );
        setLoading(false);
      }
    }

    loadTOC();
  }, [bookId, getBook, updateBook]);

  const handleNavigate = (item: TOCItem) => {
    setActiveItem(item.id);
    setCurrentPage(item.page);
  };

  if (collapsed) {
    return (
      <div className="h-full border-r">
        <div className="flex h-14 items-center justify-center border-b">
          <Menu className="h-6 w-6" />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full border-r">
      <div className="flex h-14 items-center px-4 border-b">
        <h2 className="font-semibold">Table of Contents</h2>
      </div>

      <ScrollArea className="h-[calc(100vh-3.5rem)]">
        <div className="p-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : toc.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No table of contents available
            </p>
          ) : (
            <div className="space-y-1">
              {toc.map((item) => (
                <TOCItem
                  key={item.id}
                  item={item}
                  activeItem={activeItem}
                  onNavigate={handleNavigate}
                  level={0}
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

interface TOCItemProps {
  item: TOCItem;
  activeItem: string | null;
  onNavigate: (item: TOCItem) => void;
  level: number;
}

function TOCItem({ item, activeItem, onNavigate, level }: TOCItemProps) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = item.children && item.children.length > 0;

  return (
    <div>
      <Button
        variant="ghost"
        className={cn(
          "w-full justify-start gap-2 font-normal",
          activeItem === item.id && "bg-accent",
          level > 0 && "pl-[calc(1rem*var(--level))]"
        )}
        style={{ "--level": level } as React.CSSProperties}
        onClick={() => {
          onNavigate(item);
          if (hasChildren) {
            setExpanded(!expanded);
          }
        }}
      >
        {hasChildren && (
          <ChevronRight
            className={cn(
              "h-4 w-4 transition-transform",
              expanded && "rotate-90"
            )}
          />
        )}
        <span className="truncate">{item.title}</span>
      </Button>

      {hasChildren && expanded && (
        <div className="mt-1">
          {item.children?.map((child) => (
            <TOCItem
              key={child.id}
              item={child}
              activeItem={activeItem}
              onNavigate={onNavigate}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
