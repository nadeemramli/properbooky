/// <reference path="./deno.d.ts" />
/// <reference path="./supabase.d.ts" />

// Database types
export interface DatabaseBook {
  id: string;
  title: string;
  status: 'reading' | 'unread' | 'completed';
  metadata: Record<string, unknown>;
  user_id: string;
  priority_score?: number;
}

export interface DatabaseHighlight {
  id: string;
  book_id: string;
  count: number;
}

export interface Book extends DatabaseBook {
  highlights: Array<DatabaseHighlight>;
}

export interface ReadingSession {
  id: string;
  user_id: string;
  book_id: string;
  created_at: string;
  start_time: string;
  end_time: string;
  pages_read: number;
  minutes_read: number;
  reading_time: number;
}

// Response types
export interface SuccessResponse {
  success: boolean;
  data?: unknown;
}

export interface ErrorResponse {
  error: string;
  details?: unknown;
}

// Utility types
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

// Type guards
export function isErrorResponse(response: unknown): response is ErrorResponse {
  return (
    typeof response === 'object' &&
    response !== null &&
    'error' in response &&
    typeof (response as ErrorResponse).error === 'string'
  );
}

export function isBook(book: unknown): book is Book {
  return (
    typeof book === 'object' &&
    book !== null &&
    'id' in book &&
    'status' in book &&
    'user_id' in book
  );
}

export function isReadingSession(session: unknown): session is ReadingSession {
  return (
    typeof session === 'object' &&
    session !== null &&
    'id' in session &&
    'user_id' in session &&
    'book_id' in session
  );
} 