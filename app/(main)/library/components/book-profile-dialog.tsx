import { useState } from "react";
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
  Pencil,
  Save,
  X,
} from "lucide-react";
import type {
  Book,
  BookRecommendation,
  BookUpdate,
  BookMetadata,
} from "@/types/book";
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
  const [isEditing, setIsEditing] = useState(false);
  const [editedBook, setEditedBook] = useState<Partial<BookUpdate>>({});
  const [recommendations, setRecommendations] = useState<BookRecommendation[]>(
    book?.metadata?.recommendations || []
  );
  const [newRecommendation, setNewRecommendation] = useState({
    recommender_name: "",
    recommendation_text: "",
  });
  const { updateBook } = useBooks();
  const { toast } = useToast();
  const { user } = useAuth();

  if (!book || !user?.id) return null;

  const handleUpdateBook = async (updates: Partial<BookUpdate>) => {
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

  const handleSaveEdits = async () => {
    try {
      await updateBook(book.id, editedBook);
      setIsEditing(false);
      setEditedBook({});
      toast({
        title: "Success",
        description: "Book details updated successfully",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to update book details",
      });
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditedBook({});
  };

  const handleInputChange = (field: keyof Book, value: any) => {
    setEditedBook((prev) => ({ ...prev, [field]: value }));
  };

  const handleMetadataChange = (field: keyof BookMetadata, value: any) => {
    setEditedBook((prev) => {
      const currentMetadata = prev.metadata || {};
      return {
        ...prev,
        metadata: {
          ...currentMetadata,
          [field]: value,
        },
      };
    });
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
      const newRec: BookRecommendation = {
        id: crypto.randomUUID(),
        book_id: book.id,
        user_id: user.id,
        recommender_name: newRecommendation.recommender_name,
        recommendation_text: newRecommendation.recommendation_text,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Add the recommendation to the book's metadata
      const updatedMetadata: Partial<BookMetadata> = {
        ...book.metadata,
        recommendations: [...(book.metadata.recommendations || []), newRec],
      };

      await updateBook(book.id, { metadata: updatedMetadata });

      // Update local state
      setRecommendations((prev) => [...prev, newRec]);

      // Reset form
      setNewRecommendation({
        recommender_name: "",
        recommendation_text: "",
      });

      toast({
        title: "Success",
        description: "Recommendation added successfully",
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
          <DialogTitle className="flex items-center justify-between">
            <span>Book Details</span>
            {activeTab === "details" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  isEditing ? handleSaveEdits() : setIsEditing(true)
                }
              >
                {isEditing ? (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Save Changes
                  </>
                ) : (
                  <>
                    <Pencil className="h-4 w-4 mr-2" />
                    Edit Details
                  </>
                )}
              </Button>
            )}
          </DialogTitle>
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
                {isEditing ? (
                  <div className="space-y-2">
                    <Label htmlFor="title">Title</Label>
                    <Input
                      id="title"
                      value={editedBook.title ?? book.title}
                      onChange={(e) =>
                        handleInputChange("title", e.target.value)
                      }
                    />
                    <Label htmlFor="author">Author</Label>
                    <Input
                      id="author"
                      value={editedBook.author ?? book.author ?? ""}
                      onChange={(e) =>
                        handleInputChange("author", e.target.value)
                      }
                    />
                  </div>
                ) : (
                  <>
                    <h2 className="text-2xl font-bold">{book.title}</h2>
                    {book.author && (
                      <p className="text-muted-foreground">{book.author}</p>
                    )}
                  </>
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
                {isEditing ? (
                  <>
                    <div className="space-y-2">
                      <Label>Publisher</Label>
                      <Input
                        value={
                          editedBook.metadata?.publisher ??
                          book.metadata?.publisher ??
                          ""
                        }
                        onChange={(e) =>
                          handleMetadataChange("publisher", e.target.value)
                        }
                        placeholder="Publisher"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Publication Year</Label>
                      <Input
                        type="number"
                        value={
                          editedBook.publication_year ??
                          book.publication_year ??
                          ""
                        }
                        onChange={(e) =>
                          handleInputChange(
                            "publication_year",
                            parseInt(e.target.value)
                          )
                        }
                        placeholder="Publication Year"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Language</Label>
                      <Input
                        value={
                          editedBook.metadata?.language ??
                          book.metadata?.language ??
                          ""
                        }
                        onChange={(e) =>
                          handleMetadataChange("language", e.target.value)
                        }
                        placeholder="Language"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Pages</Label>
                      <Input
                        type="number"
                        value={
                          editedBook.metadata?.pages ??
                          book.metadata?.pages ??
                          ""
                        }
                        onChange={(e) =>
                          handleMetadataChange(
                            "pages",
                            parseInt(e.target.value)
                          )
                        }
                        placeholder="Number of pages"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>ISBN</Label>
                      <Input
                        value={
                          editedBook.metadata?.isbn ?? book.metadata?.isbn ?? ""
                        }
                        onChange={(e) =>
                          handleMetadataChange("isbn", e.target.value)
                        }
                        placeholder="ISBN"
                      />
                    </div>
                    <div className="col-span-2 space-y-2">
                      <Label>Description</Label>
                      <Textarea
                        value={
                          editedBook.metadata?.description ??
                          book.metadata?.description ??
                          ""
                        }
                        onChange={(e) =>
                          handleMetadataChange("description", e.target.value)
                        }
                        placeholder="Book description"
                        rows={4}
                      />
                    </div>
                    <div className="col-span-2 flex justify-end gap-2">
                      <Button variant="outline" onClick={handleCancelEdit}>
                        <X className="h-4 w-4 mr-2" />
                        Cancel
                      </Button>
                      <Button onClick={handleSaveEdits}>
                        <Save className="h-4 w-4 mr-2" />
                        Save Changes
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    {book.metadata?.publisher && (
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                          Publisher:
                        </span>
                        <span className="text-sm">
                          {book.metadata.publisher}
                        </span>
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
                        <span className="text-sm">
                          {book.metadata.language}
                        </span>
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
                        <span className="text-sm text-muted-foreground">
                          ISBN:
                        </span>
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
                    {book.metadata?.description && (
                      <div className="col-span-2 space-y-2">
                        <h3 className="font-semibold">Description</h3>
                        <p className="text-sm text-muted-foreground">
                          {book.metadata.description}
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>
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
