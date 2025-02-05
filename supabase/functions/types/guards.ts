import type { Book, ReadingSession, ErrorResponse } from './index.d.ts';

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
    'user_id' in book &&
    'title' in book
  );
}

export function isReadingSession(session: unknown): session is ReadingSession {
  return (
    typeof session === 'object' &&
    session !== null &&
    'id' in session &&
    'user_id' in session &&
    'book_id' in session &&
    'start_time' in session &&
    'end_time' in session
  );
} 