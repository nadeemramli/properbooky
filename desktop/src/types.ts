export interface Book {
  id: number;
  stable_id: string;
  asset_id: string | null;
  availability: "local" | "missing" | "none";
  reading_status: "unread" | "reading" | "paused" | "finished" | "stopped";
  want_to_read: boolean;
  up_next: boolean;
  content_type: string;
  issues: string[];
  duplicate_candidates: string[];
  assets: BookAsset[];
  source_profiles: SourceProfile[];
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
  cover: string | null;
  year: number | null;
  spectrum: string | null;
  priority: number | null;
}

export interface BookAsset {
  id: string | null;
  path: string;
  format: string;
  available: boolean;
  year: number | null;
}

export interface SourceProfile {
  id: string;
  path: string;
  kind: string;
  title: string;
  author: string | null;
  category: string | null;
  year: number | null;
  rating: number | null;
  recommended: boolean;
  reading_status: Book["reading_status"];
  want_to_read: boolean;
  up_next: boolean;
}

export type BookEdit = Pick<
  Book,
  | "title"
  | "author"
  | "category"
  | "content_type"
  | "reading_status"
  | "want_to_read"
  | "up_next"
>;

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
    type: "epub-cfi" | "pdf" | "article";
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
