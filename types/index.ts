// Common type utilities
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

// API response types
export type ApiResponse<T> = {
  data: T;
  error: null;
} | {
  data: null;
  error: {
    message: string;
    code?: string;
  };
};

// Common UI types
export type LoadingState = 'idle' | 'loading' | 'success' | 'error';

// File handling types
export type FileProgress = {
  bytesTransferred: number;
  totalBytes: number;
  progress: number;
};

export type FileStatus = 'queued' | 'uploading' | 'completed' | 'error';

export type FileUploadOptions = {
  cacheControl?: string;
  contentType?: string;
  upsert?: boolean;
  duplex?: 'half' | 'full';
};

export type FileUploadProgressEvent = {
  loaded: number;
  total: number;
}; 