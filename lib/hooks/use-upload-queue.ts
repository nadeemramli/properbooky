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
    if (isUploading || queue.length === 0) return;
    if (!user) {
      toast({
        title: "Error",
        description: "You must be logged in to upload files",
        variant: "destructive",
      });
      return;
    }

    setIsUploading(true);

    try {
      // Get the first item in the queue, return if queue is empty
      const currentItem = queue[0];
      if (!currentItem) {
        setIsUploading(false);
        return;
      }

      updateItemStatus(currentItem.id, "uploading");

      // Upload file
      const formData = new FormData();
      formData.append("file", currentItem.file);

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Failed to upload file");
      }

      const { filePath } = await response.json();

      // Create book entry
      await addBook({
        title: currentItem.file.name.replace(/\.[^/.]+$/, ""), // Remove extension
        format: currentItem.file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'epub',
        file_url: filePath,
        status: 'unread',
        user_id: user.id,
        author: null,
        cover_url: null,
        publication_year: null,
        progress: 0,
        metadata: {},
      });

      // Update status and show success toast
      updateItemStatus(currentItem.id, "completed");
      toast({
        title: "Success",
        description: `${currentItem.file.name} has been uploaded`,
      });

      // Remove from queue
      setQueue((prev) => prev.slice(1));
    } catch (error) {
      console.error("Upload error:", error);
      const failedItem = queue[0];
      if (failedItem) {
        updateItemStatus(failedItem.id, "error", error instanceof Error ? error.message : "Failed to upload file");
      }
      toast({
        title: "Error",
        description: "Failed to upload file",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  }, [queue, isUploading, uploadBookFile, addBook, updateItemStatus, user]);

  return {
    queue,
    isUploading,
    addToQueue,
    removeFromQueue,
    clearQueue,
    processQueue,
  };
} 