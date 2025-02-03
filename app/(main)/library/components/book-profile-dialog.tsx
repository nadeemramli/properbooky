"use client";

import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  BookOpen,
  Calendar,
  Clock,
  FileText,
  Tag,
  Type,
  User,
} from "lucide-react";

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

interface BookProfileDialogProps {
  book: Book | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BookProfileDialog({
  book,
  open,
  onOpenChange,
}: BookProfileDialogProps) {
  if (!book) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Book Details</DialogTitle>
        </DialogHeader>
        <div className="grid gap-6 py-4">
          <div className="flex gap-6">
            <div className="relative aspect-[3/4] h-48 overflow-hidden rounded-lg">
              <Image
                src={book.cover_url}
                alt={book.title}
                fill
                className="object-cover"
              />
            </div>
            <div className="flex-1 space-y-4">
              <div>
                <h2 className="text-2xl font-bold">{book.title}</h2>
                {book.author && (
                  <p className="text-muted-foreground">{book.author}</p>
                )}
              </div>
              <div className="flex gap-2">
                <Badge variant="secondary">{book.format.toUpperCase()}</Badge>
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
              </div>
              {book.progress !== undefined && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Reading Progress</span>
                    <span>{book.progress}%</span>
                  </div>
                  <Progress value={book.progress} />
                </div>
              )}
            </div>
          </div>

          <Separator />

          <Tabs defaultValue="details" className="flex-1">
            <TabsList>
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="highlights">Highlights</TabsTrigger>
            </TabsList>
            <TabsContent value="details" className="mt-4 space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                {book.metadata?.publisher && (
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      Publisher:
                    </span>
                    <span className="text-sm">{book.metadata.publisher}</span>
                  </div>
                )}
                {book.metadata?.published_date && (
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      Published:
                    </span>
                    <span className="text-sm">
                      {book.metadata.published_date}
                    </span>
                  </div>
                )}
                {book.metadata?.language && (
                  <div className="flex items-center gap-2">
                    <Type className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      Language:
                    </span>
                    <span className="text-sm">{book.metadata.language}</span>
                  </div>
                )}
                {book.metadata?.pages && (
                  <div className="flex items-center gap-2">
                    <BookOpen className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      Pages:
                    </span>
                    <span className="text-sm">{book.metadata.pages}</span>
                  </div>
                )}
                {book.metadata?.isbn && (
                  <div className="flex items-center gap-2">
                    <Tag className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">ISBN:</span>
                    <span className="text-sm">{book.metadata.isbn}</span>
                  </div>
                )}
                {book.added_date && (
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      Added:
                    </span>
                    <span className="text-sm">{book.added_date}</span>
                  </div>
                )}
              </div>
              {book.metadata?.description && (
                <div className="space-y-2">
                  <h3 className="font-semibold">Description</h3>
                  <p className="text-sm text-muted-foreground">
                    {book.metadata.description}
                  </p>
                </div>
              )}
            </TabsContent>
            <TabsContent value="highlights" className="mt-4">
              <ScrollArea className="h-[400px] pr-4">
                <div className="space-y-4">
                  {book.highlights?.map((highlight) => (
                    <div
                      key={highlight.id}
                      className="rounded-lg border p-4 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          Page {highlight.page}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {highlight.created_at}
                        </span>
                      </div>
                      <p className="text-sm">{highlight.content}</p>
                      {highlight.tags && highlight.tags.length > 0 && (
                        <div className="flex gap-1">
                          {highlight.tags.map((tag) => (
                            <Badge key={tag} variant="secondary">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  {(!book.highlights || book.highlights.length === 0) && (
                    <p className="text-center text-sm text-muted-foreground py-8">
                      No highlights added yet
                    </p>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
