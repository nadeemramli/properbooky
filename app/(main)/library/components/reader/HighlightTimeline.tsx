"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  Pencil,
  Save,
  X,
  Tag as TagIcon,
  MessageSquare,
  Clock,
  BookOpen,
} from "lucide-react";
import type { Highlight, HighlightTag } from "@/types/book";

interface HighlightTimelineProps {
  highlights: Highlight[];
  tags: HighlightTag[];
  onUpdateHighlight: (highlight: Highlight) => Promise<void>;
  onDeleteHighlight: (highlightId: string) => Promise<void>;
  onNavigateToHighlight: (highlight: Highlight) => void;
}

export function HighlightTimeline({
  highlights,
  tags,
  onUpdateHighlight,
  onDeleteHighlight,
  onNavigateToHighlight,
}: HighlightTimelineProps) {
  const [editingHighlight, setEditingHighlight] = useState<string | null>(null);
  const [editedNote, setEditedNote] = useState("");
  const [editedTags, setEditedTags] = useState<string[]>([]);

  const handleEdit = (highlight: Highlight) => {
    setEditingHighlight(highlight.id);
    setEditedNote(highlight.note || "");
    setEditedTags(highlight.tags);
  };

  const handleSave = async (highlight: Highlight) => {
    await onUpdateHighlight({
      ...highlight,
      note: editedNote,
      tags: editedTags,
      updated_at: new Date().toISOString(),
    });
    setEditingHighlight(null);
  };

  const handleCancel = () => {
    setEditingHighlight(null);
    setEditedNote("");
    setEditedTags([]);
  };

  return (
    <ScrollArea className="h-full">
      <div className="space-y-8 p-4">
        {highlights
          .sort(
            (a, b) =>
              new Date(b.created_at).getTime() -
              new Date(a.created_at).getTime()
          )
          .map((highlight) => (
            <div
              key={highlight.id}
              className="relative border-l-2 border-muted pl-4 pb-8"
            >
              {/* Timeline dot */}
              <div className="absolute -left-[5px] top-0 h-2 w-2 rounded-full bg-primary" />

              {/* Highlight content */}
              <div className="space-y-2">
                {/* Header with timestamp and page */}
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  <span>
                    {format(
                      new Date(highlight.created_at),
                      "MMM d, yyyy h:mm a"
                    )}
                  </span>
                  <span className="flex items-center gap-1">
                    <BookOpen className="h-4 w-4" />
                    Page {highlight.page}
                  </span>
                </div>

                {/* Highlight text */}
                <div
                  className="rounded-md border bg-muted/50 p-3"
                  style={{
                    borderLeftColor: highlight.color,
                    borderLeftWidth: 4,
                  }}
                >
                  <p className="text-sm">{highlight.content}</p>
                </div>

                {/* Tags */}
                {highlight.tags.length > 0 && (
                  <div className="flex items-center gap-2">
                    <TagIcon className="h-4 w-4 text-muted-foreground" />
                    <div className="flex flex-wrap gap-1">
                      {highlight.tags.map((tagId) => {
                        const tag = tags.find((t) => t.id === tagId);
                        if (!tag) return null;
                        return (
                          <Badge
                            key={tag.id}
                            variant="secondary"
                            style={{
                              backgroundColor: `${tag.color}20`,
                              color: tag.color,
                            }}
                          >
                            {tag.name}
                          </Badge>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Note */}
                {editingHighlight === highlight.id ? (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Note</Label>
                      <Textarea
                        value={editedNote}
                        onChange={(e) => setEditedNote(e.target.value)}
                        placeholder="Add a note..."
                        rows={3}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Tags</Label>
                      <div className="flex flex-wrap gap-1">
                        {tags.map((tag) => (
                          <Badge
                            key={tag.id}
                            variant={
                              editedTags.includes(tag.id)
                                ? "default"
                                : "secondary"
                            }
                            className="cursor-pointer"
                            style={
                              editedTags.includes(tag.id)
                                ? {
                                    backgroundColor: tag.color,
                                    color: "white",
                                  }
                                : {}
                            }
                            onClick={() =>
                              setEditedTags((prev) =>
                                prev.includes(tag.id)
                                  ? prev.filter((id) => id !== tag.id)
                                  : [...prev, tag.id]
                              )
                            }
                          >
                            {tag.name}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button size="sm" onClick={() => handleSave(highlight)}>
                        <Save className="mr-2 h-4 w-4" />
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleCancel}
                      >
                        <X className="mr-2 h-4 w-4" />
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  highlight.note && (
                    <div className="flex items-start gap-2">
                      <MessageSquare className="h-4 w-4 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        {highlight.note}
                      </p>
                    </div>
                  )
                )}

                {/* Actions */}
                {editingHighlight !== highlight.id && (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleEdit(highlight)}
                    >
                      <Pencil className="mr-2 h-4 w-4" />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onNavigateToHighlight(highlight)}
                    >
                      <BookOpen className="mr-2 h-4 w-4" />
                      Go to highlight
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => onDeleteHighlight(highlight.id)}
                    >
                      <X className="mr-2 h-4 w-4" />
                      Delete
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}
      </div>
    </ScrollArea>
  );
}
