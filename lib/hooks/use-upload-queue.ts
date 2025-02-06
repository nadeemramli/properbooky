import { useState, useCallback } from 'react';
import { toast } from '@/components/ui/use-toast';
import { useBooks } from './use-books';

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

    setIsUploading(true);

    try {
      for (const item of queue) {
        if (item.status === 'completed') continue;

        try {
          updateItemStatus(item.id, 'uploading');
          
          // Show upload started toast
          toast({
            title: 'Upload Started',
            description: `Uploading ${item.file.name}...`,
            duration: 3000,
          });

          // Start the actual upload
          const filePath = await uploadBookFile(item.file);

          // Create book entry
          await addBook({
            title: item.file.name.replace(/\.[^/.]+$/, ""), // Remove extension
            format: item.file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'epub',
            file_url: filePath,
            status: 'unread',
            user_id: 'auto', // This will be replaced with the actual user ID by the useBooks hook
          });

          // Update status and show success toast
          updateItemStatus(item.id, 'completed');
          toast({
            title: 'Upload Complete',
            description: `Successfully uploaded ${item.file.name}`,
            duration: 3000,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Upload failed';
          updateItemStatus(item.id, 'error', errorMessage);
          
          toast({
            title: 'Upload Failed',
            description: `Failed to upload ${item.file.name}: ${errorMessage}`,
            variant: 'destructive',
            duration: 5000,
          });
        }
      }
    } finally {
      setIsUploading(false);
    }
  }, [queue, isUploading, uploadBookFile, addBook, updateItemStatus]);

  return {
    queue,
    isUploading,
    addToQueue,
    removeFromQueue,
    clearQueue,
    processQueue,
  };
} 