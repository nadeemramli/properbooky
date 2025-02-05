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
import { Upload, Loader2, FileText, X } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useUploadQueue } from "../hooks/use-upload-queue";

export function BulkUploadDialog() {
  const [open, setOpen] = useState(false);
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
    await processQueue();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="h-10">
          <Upload className="mr-2 h-4 w-4" />
          Bulk Upload
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Bulk Upload Books</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div
            {...getRootProps()}
            className={cn(
              "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
              isDragActive
                ? "border-primary bg-primary/10"
                : "border-gray-300 hover:border-primary"
            )}
          >
            <input {...getInputProps()} />
            <FileText className="mx-auto h-12 w-12 text-gray-400" />
            <p className="mt-2 text-sm text-gray-600">
              {isDragActive
                ? "Drop the files here..."
                : "Drag and drop files here, or click to select files"}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              PDF and EPUB files only (max 100MB)
            </p>
          </div>

          {queue.length > 0 && (
            <div className="space-y-2">
              {queue.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center justify-between p-2 border rounded"
                >
                  <div className="flex items-center space-x-2 flex-1">
                    <FileText className="h-4 w-4" />
                    <span className="text-sm truncate">{file.name}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    {file.status === "uploading" && (
                      <Progress value={file.progress} className="w-20" />
                    )}
                    {file.status === "completed" && (
                      <span className="text-green-500 text-sm">Done</span>
                    )}
                    {file.status === "error" && (
                      <span className="text-red-500 text-sm">Error</span>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeFromQueue(file.id)}
                      disabled={isUploading}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}

              <div className="flex justify-end space-x-2">
                <Button
                  variant="outline"
                  onClick={clearQueue}
                  disabled={isUploading}
                >
                  Clear All
                </Button>
                <Button onClick={handleUpload} disabled={isUploading}>
                  {isUploading && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  {isUploading ? "Uploading..." : "Upload All"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
