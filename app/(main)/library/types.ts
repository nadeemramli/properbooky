// Book status type
export type BookStatus = "unread" | "reading" | "completed" | "wishlist";

// Book metadata type
export type BookMetadata = {
  description?: string;
  isbn?: string;
  recommendation?: string;
  notes?: string;
  source?: string;
  priority?: number;
};

// Main book type
export type Book = {
  id: string;
  title: string;
  author?: string;
  format: "pdf" | "epub";
  file_url: string;
  created_at: string;
  updated_at: string;
  user_id: string;
  size?: number;
  pages?: number;
  cover_url: string | null;
  status: BookStatus;
  progress: number | null;
  last_read: string | null;
  metadata: BookMetadata;
};

// Upload operation types
export type BookFormat = "pdf" | "epub";

export type BookUpload = {
  file: File;
  format: BookFormat;
  file_url: string;
}; 