"use client";

import Image from "next/image";
import { useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import {
  BookOpen,
  Calendar,
  Clock,
  FileText,
  Tag,
  Type,
  User,
  Star,
  Brain,
  ThumbsUp,
} from "lucide-react";
import type { Book, BookRecommendation } from "@/types/book";
import { BOOK_STATUS_VARIANTS } from "@/lib/constants";
import { useBooks } from "@/lib/hooks/use-books";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/lib/hooks/use-auth";

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
  const [activeTab, setActiveTab] = useState("details");
  const [recommendations, setRecommendations] = useState<BookRecommendation[]>(
    []
  );
  const [newRecommendation, setNewRecommendation] = useState({
    recommender_name: "",
    recommendation_text: "",
  });
  const { updateBook } = useBooks();
  const { toast } = useToast();
  const { user } = useAuth();

  if (!book || !user?.id) return null;

  const handleUpdateBook = async (updates: Partial<Book>) => {
    try {
      await updateBook(book.id, updates);
      toast({
        title: "Success",
        description: "Book updated successfully",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to update book",
      });
    }
  };

  const handleAddRecommendation = async () => {
    if (
      !newRecommendation.recommender_name ||
      !newRecommendation.recommendation_text
    ) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Please fill in all fields",
      });
      return;
    }

    try {
      // Implementation for adding recommendations
      // This will be implemented when we add the recommendations API
      toast({
        title: "Success",
        description: "Recommendation added successfully",
      });
      setNewRecommendation({
        recommender_name: "",
        recommendation_text: "",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to add recommendation",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Book Details</DialogTitle>
        </DialogHeader>
        <div className="grid gap-6 py-4">
          <div className="flex gap-6">
            <div className="relative aspect-[3/4] h-48 overflow-hidden rounded-lg">
              {book.cover_url ? (
                <Image
                  src={book.cover_url}
                  alt={book.title}
                  fill
                  className="object-cover"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center bg-muted">
                  <BookOpen className="h-12 w-12 text-muted-foreground" />
                </div>
              )}
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
                <Badge variant={BOOK_STATUS_VARIANTS[book.status]}>
                  {book.status}
                </Badge>
              </div>
              {book.progress !== undefined && book.progress !== null && (
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

          <Tabs defaultValue={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="metadata">Metadata</TabsTrigger>
              <TabsTrigger value="recommendations">Recommendations</TabsTrigger>
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
                {book.publication_year && (
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      Published:
                    </span>
                    <span className="text-sm">{book.publication_year}</span>
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
                {book.created_at && (
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      Added:
                    </span>
                    <span className="text-sm">{book.created_at}</span>
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

            <TabsContent value="metadata" className="mt-4 space-y-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Knowledge Spectrum Score</Label>
                  <div className="flex items-center gap-4">
                    <Slider
                      value={[book.knowledge_spectrum || 0.5]}
                      onValueChange={(value) =>
                        handleUpdateBook({ knowledge_spectrum: value[0] })
                      }
                      min={0}
                      max={1}
                      step={0.1}
                      className="flex-1"
                    />
                    <span className="w-12 text-right">
                      {book.knowledge_spectrum?.toFixed(1) || "0.5"}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    0 = Collection of ideas, 1 = Completely original ideas
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Manual Rating</Label>
                  <div className="flex items-center gap-4">
                    <Slider
                      value={[book.manual_rating || 2.5]}
                      onValueChange={(value) =>
                        handleUpdateBook({ manual_rating: value[0] })
                      }
                      min={0}
                      max={5}
                      step={0.5}
                      className="flex-1"
                    />
                    <span className="w-12 text-right">
                      {book.manual_rating?.toFixed(1) || "2.5"}
                    </span>
                  </div>
                </div>

                {book.status === "wishlist" && (
                  <>
                    <div className="space-y-2">
                      <Label>Priority</Label>
                      <div className="flex items-center gap-4">
                        <Slider
                          value={[book.wishlist_priority || 0]}
                          onValueChange={(value) =>
                            handleUpdateBook({ wishlist_priority: value[0] })
                          }
                          min={0}
                          max={10}
                          step={1}
                          className="flex-1"
                        />
                        <span className="w-12 text-right">
                          {book.wishlist_priority || "0"}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Notes</Label>
                      <Textarea
                        value={book.wishlist_notes || ""}
                        onChange={(e) =>
                          handleUpdateBook({ wishlist_notes: e.target.value })
                        }
                        placeholder="Add notes about this book..."
                      />
                    </div>
                  </>
                )}
              </div>
            </TabsContent>

            <TabsContent value="recommendations" className="mt-4">
              <ScrollArea className="h-[400px] pr-4">
                <div className="space-y-4">
                  {recommendations.map((rec) => (
                    <div
                      key={rec.id}
                      className="rounded-lg border p-4 space-y-2"
                    >
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">
                          {rec.recommender_name}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {rec.recommendation_text}
                      </p>
                    </div>
                  ))}

                  <div className="space-y-4 pt-4">
                    <h4 className="font-medium">Add Recommendation</h4>
                    <div className="space-y-2">
                      <Label>Recommender Name</Label>
                      <Input
                        value={newRecommendation.recommender_name}
                        onChange={(e) =>
                          setNewRecommendation({
                            ...newRecommendation,
                            recommender_name: e.target.value,
                          })
                        }
                        placeholder="Who recommended this book?"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Recommendation</Label>
                      <Textarea
                        value={newRecommendation.recommendation_text}
                        onChange={(e) =>
                          setNewRecommendation({
                            ...newRecommendation,
                            recommendation_text: e.target.value,
                          })
                        }
                        placeholder="Why did they recommend this book?"
                      />
                    </div>
                    <Button
                      onClick={handleAddRecommendation}
                      className="w-full"
                    >
                      Add Recommendation
                    </Button>
                  </div>
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
