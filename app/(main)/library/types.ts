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
  publisher?: string;
  published_date?: string;
  language?: string;
  pages?: number;
  categories?: string[];
  tags?: string[];
  cover_url?: string;
  wishlist_reason?: string;
  wishlist_source?: string;
  wishlist_added_date?: string;
  wishlist_priority?: number;
  goodreads_url?: string;
  amazon_url?: string;
  size?: number;
  title?: string;
  author?: string;
};

// Book creation type
export type BookCreate = {
  title: string;
  author: string | null;
  format: "pdf" | "epub";
  file_url: string;
  status: BookStatus;
  progress: number;
  user_id: string;
  metadata?: Partial<BookMetadata>;
};

// Main book type
export type Book = {
  id: string;
  title: string;
  author?: string;
  format: "pdf" | "epub" | null; // null for wishlist items
  file_url: string | null; // null for wishlist items
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
  cover_url: string | null;
  metadata: Partial<BookMetadata>;
};

// Upload result type
export type BookUploadResult = BookUpload & {
  metadata: Partial<BookMetadata>;
};

// CSV import type for wishlist
export type WishlistCSVRow = {
  title: string;
  author?: string;
  isbn?: string;
  reason?: string;
  source?: string;
  priority?: number;
  notes?: string;
  goodreads_url?: string;
  amazon_url?: string;
}; 