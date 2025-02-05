export type BookStatus = "unread" | "reading" | "completed" | "wishlist";

export interface Book {
  id?: string;
  title: string;
  author: string | null;
  cover_url: string | null;
  file_url: string | null;
  format: "epub" | "pdf" | null;
  status: BookStatus;
  progress: number | null;
  created_at: string;
  updated_at: string;
  last_read: string | null;
  user_id: string;
  metadata: {
    description?: string;
    isbn?: string;
    recommendation?: string;
    notes?: string;
    source?: string;
    priority?: number;
  };
}

// For the upload operation
export interface BookUpload {
  file: File;
  format: "epub" | "pdf";
  file_url: string;
} 