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
  recommended: boolean;
}

export interface LibraryState {
  library_path: string | null;
  book_count: number;
}

export interface ScanResult {
  indexed: number;
  skipped: number;
}

export interface Highlight {
  id: string;
  text: string;
  note: string | null;
  color: string | null;
  anchor: {
    type: "epub-cfi" | "pdf";
    cfi?: string;
    page?: number;
    quote?: { exact: string; prefix: string; suffix: string };
    position?: { start: number; end: number };
  };
  created_at: number;
  updated_at: number;
  deleted: boolean;
}

export interface Sidecar {
  position: string | null;
  percent: number | null;
  updated_at: number;
  highlights: Highlight[];
}

export interface OpenTab {
  path: string;
  title: string;
  format: string;
  percent: number | null;
}
