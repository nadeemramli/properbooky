"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Upload, X, FileText, Loader2, Cloud } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/use-toast";

interface FilePreview {
  file: File;
  id: string;
  progress: number;
  status: "pending" | "uploading" | "completed" | "error";
}

export function BulkUploadDialog() {
  const [open, setOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [files, setFiles] = useState<FilePreview[]>([]);
  const { toast } = useToast();

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const droppedFiles = Array.from(e.dataTransfer.files);
    const validFiles = droppedFiles.filter(
      (file) =>
        file.type === "application/pdf" || file.type === "application/epub+zip"
    );

    if (validFiles.length !== droppedFiles.length) {
      toast({
        title: "Invalid files",
        description: "Only PDF and EPUB files are supported.",
        variant: "destructive",
      });
    }

    addFiles(validFiles);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files);
      addFiles(selectedFiles);
    }
  };

  const addFiles = (newFiles: File[]) => {
    const newFilePreviews: FilePreview[] = newFiles.map((file) => ({
      file,
      id: Math.random().toString(36).substring(7),
      progress: 0,
      status: "pending",
    }));
    setFiles((prev) => [...prev, ...newFilePreviews]);
  };

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((file) => file.id !== id));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" className="gap-2">
          <Upload className="h-4 w-4" />
          Bulk Upload
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Work Items Bulk Upload</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <div
            className={cn(
              "relative flex flex-col items-center justify-center rounded-lg border border-dashed p-12",
              "hover:border-primary/50 hover:bg-muted/50 transition-colors",
              dragActive
                ? "border-primary/50 bg-muted/50"
                : "border-muted-foreground/25"
            )}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <input
              type="file"
              multiple
              accept=".epub,.pdf"
              onChange={handleFileInput}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />

            <div className="flex flex-col items-center justify-center gap-4">
              <div className="rounded-full bg-muted p-4">
                <Cloud className="h-8 w-8 text-muted-foreground" />
              </div>
              <div className="flex flex-col items-center gap-2 text-center">
                <p className="text-sm font-medium">
                  Drag & drop files or Browse
                </p>
                <p className="text-xs text-muted-foreground">
                  Upload your book files here. We support PDF and EPUB formats.
                </p>
              </div>
              <Button variant="secondary" size="sm" className="relative">
                Choose Files
                <input
                  type="file"
                  multiple
                  accept=".epub,.pdf"
                  onChange={handleFileInput}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
              </Button>
            </div>
          </div>

          {files.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Files to upload</p>
                <p className="text-xs text-muted-foreground">
                  {files.length} file{files.length > 1 ? "s" : ""} selected
                </p>
              </div>
              <div className="divide-y divide-border rounded-md border">
                {files.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center justify-between p-3"
                  >
                    <div className="flex items-center gap-3">
                      <FileText className="h-8 w-8 text-muted-foreground" />
                      <div className="space-y-1">
                        <p className="text-sm font-medium">{file.file.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {(file.file.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {file.status === "uploading" && (
                        <div className="flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span className="text-xs text-muted-foreground">
                            {file.progress}%
                          </span>
                        </div>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => removeFile(file.id)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {files.length > 0 && (
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setFiles([])}>
                Clear All
              </Button>
              <Button>
                Upload {files.length} file{files.length > 1 ? "s" : ""}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
