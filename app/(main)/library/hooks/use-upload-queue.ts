import { useState, useCallback } from 'react';
import { uploadBookFile } from '../services/file-upload';
import { createClient } from '@/lib/supabase/client';
import type { FileProgress, FileStatus } from '@/types';
import { toastService, type ToastReturn } from '../services/toast-service';

// Helper function to convert File to QueuedFile
function createQueuedFile(file: File, options: Partial<Omit<QueuedFile, keyof File>> = {}): QueuedFile {
  return Object.assign(file, {
    id: Math.random().toString(36).substr(2, 9),
    progress: 0,
    status: 'queued' as const,
    ...options
  }) as QueuedFile;
}

export type QueuedFile = File & {
  id: string;
  progress: number;
  status: FileStatus;
  error?: string;
};

export function useUploadQueue() {
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [toasts, setToasts] = useState<Map<string, ToastReturn>>(new Map());
  const supabase = createClient();

  const addToQueue = useCallback((files: File[]) => {
    const newFiles = files.map(file => createQueuedFile(file));
    setQueue(prev => [...prev, ...newFiles]);
  }, []);

  const removeFromQueue = useCallback((id: string) => {
    setQueue(prev => prev.filter(file => file.id !== id));
    const toast = toasts.get(id);
    if (toast) {
      toastService.dismiss(toast.id);
      setToasts(prev => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    }
  }, [toasts]);

  const clearQueue = useCallback(() => {
    toasts.forEach(toast => toastService.dismiss(toast.id));
    setToasts(new Map());
    setQueue([]);
  }, [toasts]);

  const updateFileProgress = useCallback((id: string, progress: FileProgress) => {
    setQueue(prev =>
      prev.map(file =>
        file.id === id
          ? createQueuedFile(file, {
              progress: Math.round(progress.progress),
              status: 'uploading'
            })
          : file
      )
    );
  }, []);

  const processQueue = useCallback(async () => {
    if (isUploading) return;
    setIsUploading(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toastService.error("You must be logged in to upload files");
      setIsUploading(false);
      return;
    }

    try {
      const uploadToast = toastService.show({
        title: "Uploading Books",
        description: "Starting upload...",
        duration: Infinity,
      });

      for (const file of queue) {
        if (file.status === 'completed') continue;

        try {
          setQueue(prev =>
            prev.map(f =>
              f.id === file.id ? createQueuedFile(f, { status: 'uploading' }) : f
            )
          );

          const fileToast = toastService.progress(`Uploading ${file.name}`, 0);
          setToasts(prev => new Map(prev).set(file.id, fileToast));

          await uploadBookFile(file, user.id, (progress) => {
            updateFileProgress(file.id, progress);
            const toast = toasts.get(file.id);
            if (toast) {
              toastService.update(toast.id, {
                title: `Uploading ${file.name}`,
                description: `${Math.round(progress.progress)}%`,
                duration: Infinity,
              });
            }
          });

          setQueue(prev =>
            prev.map(f =>
              f.id === file.id
                ? createQueuedFile(f, { status: 'completed', progress: 100 })
                : f
            )
          );

          const toast = toasts.get(file.id);
          if (toast) {
            toastService.update(toast.id, {
              title: `${file.name} uploaded successfully`,
              description: "100%",
              duration: 3000,
            });
          }
        } catch (error) {
          setQueue(prev =>
            prev.map(f =>
              f.id === file.id
                ? createQueuedFile(f, {
                    status: 'error',
                    error: error instanceof Error ? error.message : 'Upload failed'
                  })
                : f
            )
          );

          toastService.error(
            error instanceof Error ? error.message : 'Upload failed'
          );
        }
      }

      toastService.update(uploadToast.id, {
        title: "Upload Complete",
        description: `Successfully uploaded ${
          queue.filter(f => f.status === 'completed').length
        } of ${queue.length} files`,
        duration: 3000,
      });
    } finally {
      setIsUploading(false);
    }
  }, [queue, isUploading, supabase.auth, updateFileProgress, toasts]);

  return {
    queue,
    isUploading,
    addToQueue,
    removeFromQueue,
    clearQueue,
    processQueue,
    updateFileProgress
  };
} 