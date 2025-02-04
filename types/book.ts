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
  [key: string]: any; // Allow additional properties
}

export interface Book {
  id: string;
  title: string;
  author: string | null;
  cover_url: string | null;
  file_url: string;
  format: 'epub' | 'pdf';
  status: 'unread' | 'reading' | 'completed';
  progress: number | null;
  created_at: string;
  updated_at: string;
  last_read: string | null;
  user_id: string;
  metadata: BookMetadata | null;
  highlights?: Highlight[];
} 