import type { Json } from '@/types/database';

export interface Highlight {
  id: string;
  book_id: string;
  user_id: string;
  content: string;
  note?: string;
  color: string;
  page: number;
  position?: {
    boundingRect: DOMRect;
    rects: DOMRect[];
    pageIndex: number;
  };
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface HighlightTag {
  id: string;
  name: string;
  color: string;
  created_at: string;
}

export type BookStatus = 'unread' | 'reading' | 'completed' | 'wishlist';
export type BookFormat = 'epub' | 'pdf';
export type WishlistStatus = 'pending' | 'acquired' | 'removed';

export interface Tag {
  id: string;
  name: string;
  user_id: string;
  color: string;
  created_at: string;
  updated_at: string;
}

export interface BookMetadata {
  isbn?: string;
  description?: string;
  publisher?: string;
  language?: string;
  pageCount?: number;
  categories?: string[];
  averageRating?: number;
  ratingCount?: number;
  thumbnail?: string;
  // Wishlist fields
  wishlist_reason?: string;
  wishlist_source?: string;
  wishlist_priority?: number;
  wishlist_added_date?: string;
  notes?: string;
  goodreads_url?: string;
  amazon_url?: string;
  // Additional metadata
  recommendations?: BookRecommendation[];
  bookmarks?: Bookmark[];
  toc?: TOCItem[];
  highlights?: Highlight[];
  // File metadata
  size?: number;
  pages?: number;
  publication_year?: number;
  // Content metadata
  title?: string;
  author?: string;
  tags?: string[];
  cover_url?: string;
  published_date?: string;
}

export interface Book {
  id: string;
  title: string;
  author?: string;
  format: "pdf" | "epub" | null;
  file_url: string | null;
  cover_url?: string | null;
  status: "unread" | "reading" | "completed" | "wishlist";
  progress?: number | null;
  last_read?: string | null;
  created_at: string;
  updated_at: string;
  publication_year?: number | null;
  knowledge_spectrum?: number | null;
  manual_rating?: number | null;
  wishlist_priority?: number | null;
  wishlist_notes?: string | null;
  metadata: BookMetadata;
  priority_score?: number | null;
  size?: number | null;
  pages?: number | null;
  highlights?: Highlight[];
  user_id: string;
}

export interface BookRecommendation {
  id: string;
  book_id: string;
  user_id: string;
  recommender_name: string;
  recommendation_text: string;
  created_at: string;
  updated_at: string;
}

export interface UserPriorityWeights {
  id: string;
  user_id: string;
  lindy_effect_weight: number;
  recommendation_weight: number;
  manual_rating_weight: number;
  knowledge_spectrum_weight: number;
  created_at: string;
  updated_at: string;
}

export interface BookTag {
  book_id: string;
  tag_id: string;
  user_id: string;
  created_at: string;
}

export interface BookCreate {
  title: string;
  author: string | null;
  format: "pdf" | "epub";
  file_url: string;
  cover_url: string | null;
  status: "unread" | "reading" | "completed" | "wishlist";
  publication_year: number | null;
  progress: number | null;
  priority_score?: number;
  user_id: string;
  metadata: Partial<BookMetadata>;
}

export interface BookUpdate {
  title?: string;
  author?: string | null;
  format?: "pdf" | "epub";
  file_url?: string;
  cover_url?: string | null;
  status?: "unread" | "reading" | "completed" | "wishlist";
  progress?: number | null;
  last_read?: string | null;
  publication_year?: number | null;
  knowledge_spectrum?: number | null;
  manual_rating?: number | null;
  wishlist_priority?: number | null;
  wishlist_notes?: string | null;
  metadata?: Partial<BookMetadata>;
}

export interface BookUpload {
  file: File;
  format: BookFormat;
  file_url: string;
  cover_url: string | null;
  metadata: Partial<BookMetadata>;
  publication_year?: number;
}

export type BookUploadResult = BookUpload & {
  metadata: Partial<BookMetadata>;
};

export interface WishlistCSVRow {
  title: string;
  author?: string;
  isbn?: string;
  reason?: string;
  source?: string;
  priority?: number;
  notes?: string;
  goodreads_url?: string;
  amazon_url?: string;
}

export interface TOCItem {
  id: string;
  title: string;
  page: number;
  level: number;
  children?: TOCItem[];
}

export interface Bookmark {
  id: string;
  book_id: string;
  user_id: string;
  page: number;
  content?: string;
  title: string;
  created_at: string;
} 