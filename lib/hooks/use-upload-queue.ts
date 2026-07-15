import { useState, useCallback } from 'react';
import { toast } from '@/components/ui/use-toast';
import { useBooks } from './use-books';
import { useAuth } from './use-auth';

interface QueueItem {
  id: string;
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'completed' | 'error';
  error?: string;
}

export function useUploadQueue() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const { uploadBookFile, addBook } = useBooks();
  const { user } = useAuth();

  const addToQueue = useCallback((files: File[]) => {
    const newItems = files.map((file) => ({
      id: Math.random().toString(36).substring(7),
      file,
      progress: 0,
      status: 'pending' as const,
    }));
    setQueue((prev) => [...prev, ...newItems]);
  }, []);

  const removeFromQueue = useCallback((id: string) => {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const clearQueue = useCallback(() => {
    setQueue([]);
  }, []);

  const updateItemProgress = useCallback((id: string, progress: number) => {
    setQueue((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, progress } : item
      )
    );
  }, []);

  const updateItemStatus = useCallback((
    id: string, 
    status: QueueItem['status'], 
    error?: string
  ) => {
    setQueue((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, status, error } : item
      )
    );
  }, []);

  const processQueue = useCallback(async () => {
    if (isUploading) return { succeeded: 0, failed: 0 };
    if (!user) {
      toast({
        title: "Error",
        description: "You must be logged in to upload files",
        variant: "destructive",
      });
      return { succeeded: 0, failed: 0 };
    }

    const items = queue.filter(
      (item) => item.status === "pending" || item.status === "error"
    );
    if (items.length === 0) return { succeeded: 0, failed: 0 };

    setIsUploading(true);
    let succeeded = 0;
    let failed = 0;

    try {
      // Process every queued file, not just the first one, and keep going
      // when an individual file fails so one bad file can't drop the rest.
      for (const item of items) {
        updateItemStatus(item.id, "uploading");
        try {
          const fileUrl = await uploadBookFile(item.file);

          await addBook({
            title: item.file.name.replace(/\.[^/.]+$/, ""), // Remove extension
            format: item.file.name.toLowerCase().endsWith(".pdf")
              ? "pdf"
              : "epub",
            file_url: fileUrl,
            status: "unread",
            user_id: user.id,
            author: null,
            cover_url: null,
            publication_year: null,
            progress: 0,
            metadata: {},
          });

          updateItemProgress(item.id, 100);
          updateItemStatus(item.id, "completed");
          succeeded++;
        } catch (error) {
          console.error("Upload error:", error);
          updateItemStatus(
            item.id,
            "error",
            error instanceof Error ? error.message : "Failed to upload file"
          );
          failed++;
        }
      }
    } finally {
      setIsUploading(false);
    }

    return { succeeded, failed };
  }, [
    queue,
    isUploading,
    uploadBookFile,
    addBook,
    updateItemStatus,
    updateItemProgress,
    user,
  ]);

  return {
    queue,
    isUploading,
    addToQueue,
    removeFromQueue,
    clearQueue,
    processQueue,
  };
} 