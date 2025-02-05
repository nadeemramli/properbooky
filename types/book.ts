import type { Json } from '@/types/database';

export interface Highlight {
  id: string;
  content: string;
  page: number;
  created_at: string;
  tags?: string[];
}

export interface BookMetadata {
  publisher?: string;
  published_date?: string;
  language?: string;
  pages?: number;
  isbn?: string;
  description?: string;
  [key: string]: unknown;
}

// Ensure this matches the database schema exactly
export interface Book {
  id: string;
  title: string;
  author: string | null;
  cover_url: string | null;
  file_url: string;
  format: 'epub' | 'pdf';
  status: 'unread' | 'reading' | 'completed';
  progress: number;
  created_at: string;
  updated_at: string;
  last_read: string | null;
  user_id: string;
  metadata: BookMetadata;
  priority_score: number;
  highlights?: Highlight[];
}

// Type for creating a new book - accepts both BookMetadata and Json
export interface BookCreate {
  title: string;
  author?: string | null;
  cover_url?: string | null;
  file_url: string;
  format: 'epub' | 'pdf';
  status?: 'unread' | 'reading' | 'completed';
  progress?: number;
  user_id: string;
  metadata?: BookMetadata | Json;
  priority_score?: number;
}

// Type for updating a book - accepts both BookMetadata and Json
export interface BookUpdate {
  title?: string;
  author?: string | null;
  cover_url?: string | null;
  file_url?: string;
  format?: 'epub' | 'pdf';
  status?: 'unread' | 'reading' | 'completed';
  progress?: number;
  metadata?: BookMetadata | Json;
  priority_score?: number;
  last_read?: string | null;
} 