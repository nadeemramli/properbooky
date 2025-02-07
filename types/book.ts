import type { Json } from '@/types/database';

export interface Highlight {
  id: string;
  content: string;
  page: number;
  created_at: string;
  tags?: string[];
}

export type BookStatus = 'unread' | 'reading' | 'completed' | 'wishlist';
export type BookFormat = 'epub' | 'pdf';
export type WishlistStatus = 'pending' | 'acquired' | 'removed';

export interface BookMetadata {
  publisher?: string;
  published_date?: string;
  language?: string;
  pages?: number;
  isbn?: string;
  description?: string;
  wishlist_reason?: string;
  wishlist_source?: string;
  wishlist_priority?: number;
  wishlist_added_date?: string;
  notes?: string;
  goodreads_url?: string;
  amazon_url?: string;
  [key: string]: unknown;
}

// Ensure this matches the database schema exactly
export interface Book {
  id: string;
  title: string;
  author: string | null;
  cover_url: string | null;
  file_url: string;
  format: BookFormat;
  status: BookStatus;
  progress: number;
  created_at: string;
  updated_at: string;
  last_read: string | null;
  user_id: string;
  metadata: BookMetadata;
  priority_score: number;
  highlights?: Highlight[];
  
  // New fields
  publication_year?: number;
  knowledge_spectrum?: number; // 0.00 to 1.00
  manual_rating?: number;     // 0.00 to 5.00
  wishlist_status?: WishlistStatus;
  wishlist_priority?: number;
  wishlist_notes?: string;
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

// Type for creating a new book - accepts both BookMetadata and Json
export interface BookCreate {
  title: string;
  author?: string | null;
  cover_url?: string | null;
  file_url: string;
  format: BookFormat;
  status?: BookStatus;
  progress?: number;
  user_id: string;
  metadata?: BookMetadata | Json;
  priority_score?: number;
  publication_year?: number;
  knowledge_spectrum?: number;
  manual_rating?: number;
  wishlist_status?: WishlistStatus;
  wishlist_priority?: number;
  wishlist_notes?: string;
}

// Type for updating a book - accepts both BookMetadata and Json
export interface BookUpdate {
  title?: string;
  author?: string | null;
  cover_url?: string | null;
  file_url?: string;
  format?: BookFormat;
  status?: BookStatus;
  progress?: number;
  metadata?: BookMetadata | Json;
  priority_score?: number;
  last_read?: string | null;
  publication_year?: number;
  knowledge_spectrum?: number;
  manual_rating?: number;
  wishlist_status?: WishlistStatus;
  wishlist_priority?: number;
  wishlist_notes?: string;
} 