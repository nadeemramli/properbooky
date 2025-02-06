"use client";

import { FileText, X, CheckCircle2, AlertCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";

interface UploadProgressToastProps {
  fileName: string;
  progress: number;
  status: "uploading" | "completed" | "error";
  error?: string;
  onCancel?: () => void;
}

export function UploadProgressToast({
  fileName,
  progress,
  status,
  error,
  onCancel,
}: UploadProgressToastProps) {
  return (
    <div className="w-full">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{fileName}</p>
          {status === "error" && error && (
            <p className="text-xs text-destructive truncate">{error}</p>
          )}
        </div>
        {status === "uploading" && onCancel && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onCancel}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
        {status === "completed" && (
          <CheckCircle2 className="h-4 w-4 text-green-500" />
        )}
        {status === "error" && (
          <AlertCircle className="h-4 w-4 text-destructive" />
        )}
      </div>
      {status === "uploading" && (
        <div className="mt-2">
          <Progress value={progress} className="h-1" />
          <p className="text-xs text-muted-foreground mt-1">
            {progress}% uploaded
          </p>
        </div>
      )}
    </div>
  );
}
