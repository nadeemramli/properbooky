export interface Book {
  id: string;
  title: string;
  cover_url?: string;
  file_url: string;
  format: 'epub' | 'pdf';
  status: 'unread' | 'reading' | 'completed';
  progress?: number;
  author?: string;
  created_at: string;
  updated_at: string;
  last_read?: string;
  user_id: string;
  metadata?: {
    publisher?: string;
    published_date?: string;
    language?: string;
    pages?: number;
    isbn?: string;
    description?: string;
  };
} 