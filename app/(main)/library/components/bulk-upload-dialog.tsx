"use client";

import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Upload, X, FileText, AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { useUploadQueue } from "@/lib/hooks/use-upload-queue";
import { useToast } from "@/components/ui/use-toast";

interface QueueItem {
  id: string;
  file: File;
  progress: number;
  status: "pending" | "uploading" | "completed" | "error";
  error?: string;
}

export function BulkUploadDialog() {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const {
    queue,
    isUploading,
    addToQueue,
    removeFromQueue,
    clearQueue,
    processQueue,
  } = useUploadQueue();

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      addToQueue(acceptedFiles);
    },
    [addToQueue]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
      "application/epub+zip": [".epub"],
    },
    maxSize: 100 * 1024 * 1024, // 100MB
  });

  const handleUpload = async () => {
    try {
      await processQueue();
      toast({
        title: "Upload Complete",
        description: `Successfully uploaded ${queue.length} files`,
      });
      setOpen(false); // Close dialog after successful upload
      clearQueue(); // Clear the queue after successful upload
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Upload Failed",
        description:
          error instanceof Error ? error.message : "Failed to upload files",
      });
    }
  };

  // Reset state when dialog closes
  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen && !isUploading) {
      clearQueue();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Upload className="h-4 w-4" />
          Bulk Upload
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Bulk Upload Books</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Drag & Drop Zone */}
          <div
            {...getRootProps()}
            className={cn(
              "border-2 border-dashed rounded-lg p-8 transition-colors",
              "hover:border-primary/50 hover:bg-muted/50",
              isDragActive ? "border-primary bg-primary/5" : "border-muted"
            )}
          >
            <input {...getInputProps()} />
            <div className="flex flex-col items-center gap-2 text-center">
              <Upload className="h-8 w-8 text-muted-foreground" />
              {isDragActive ? (
                <p className="text-primary">Drop the files here ...</p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    Drag & drop files here, or click to select files
                  </p>
                  <p className="text-xs text-muted-foreground/80">
                    Supports: PDF, EPUB (max 100MB)
                  </p>
                </>
              )}
            </div>
          </div>

          {/* File List */}
          {queue.length > 0 && (
            <ScrollArea className="h-[200px] rounded-md border border-muted p-4">
              <div className="space-y-2">
                {queue.map((item: QueueItem) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-muted bg-muted/50 p-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                      <span className="text-sm truncate">{item.file.name}</span>
                      {item.error && (
                        <span className="text-xs text-destructive truncate">
                          {item.error}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {item.status === "error" && (
                        <AlertCircle className="h-4 w-4 text-destructive" />
                      )}
                      {item.status === "uploading" && (
                        <div className="w-20">
                          <Progress value={item.progress} className="h-2" />
                          <span className="text-xs text-muted-foreground">
                            {item.progress}%
                          </span>
                        </div>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 hover:bg-muted"
                        onClick={() => removeFromQueue(item.id)}
                        disabled={isUploading && item.status === "uploading"}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}

          {/* Upload Buttons */}
          {queue.length > 0 && (
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={clearQueue}
                disabled={isUploading}
              >
                Clear All
              </Button>
              <Button
                size="sm"
                onClick={handleUpload}
                disabled={isUploading || queue.length === 0}
              >
                {isUploading && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {isUploading ? "Uploading..." : `Upload ${queue.length} files`}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
