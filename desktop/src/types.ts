export interface Book {
  id: number;
  path: string;
  filename: string;
  title: string;
  author: string | null;
  category: string | null;
  kind: string;
  status: string | null;
  rating: number | null;
  file_link: string | null;
  format: string;
  size_bytes: number;
}

export interface LibraryState {
  library_path: string | null;
  book_count: number;
}

export interface ScanResult {
  indexed: number;
  skipped: number;
}

export interface ReadingProgress {
  position: string;
  percent: number | null;
  updated_at: number;
}

export interface OpenTab {
  path: string;
  title: string;
  format: string;
  percent: number | null;
}
