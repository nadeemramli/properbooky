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
  browse_authors: string[];
  browse_topics: string[];
  metadata_source: {
    source_url: string;
    accepted_at: number;
    suggested_title: string;
    suggested_authors: string[];
    suggested_topics: string[];
    cover: string | null;
  } | null;
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
  /** Fraction read, from the book's sidecar in the library folder. */
  progress: number | null;
}

export interface MetadataCandidate {
  key: string;
  title: string;
  author_name: string[];
  subject: string[];
  first_publish_year: number | null;
  cover_i: number | null;
}

export interface Organisation {
  authors: Record<string, string>;
  topics: Record<string, string>;
  roadmaps: {
    id: string;
    title: string;
    description: string;
    steps: { profile_id: string; note: string }[];
  }[];
}
export interface OrganisationView {
  revision: number;
  value: Organisation;
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
  library_id: string | null;
  library_name: string | null;
  library_path: string | null;
  status: "available" | "missing" | "inaccessible" | "not_folder" | null;
  book_count: number;
  /** Recovery notices for the open library, e.g. a rebuilt index. */
  notices: string[];
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
    /** EPUB: spine section, its TOC label and the book fraction at creation. */
    href?: string;
    chapter?: string;
    percent?: number;
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
  /** Present when an unreadable sidecar was set aside on load. */
  notice?: string;
}

export interface OpenTab {
  path: string;
  title: string;
  format: string;
  percent: number | null;
}

/** PBK-19: result of importing the Library of Books CSV export. */
export interface CatalogImportResult {
  report: {
    dry_run: boolean;
    rows: number;
    blank_rows: number;
    created: { line: number; file: string; renamed: boolean }[];
    existing: { line: number; file: string; differs: string[] }[];
    duplicates: { line: number; first_line: number; differs: string[] }[];
    near_duplicates: { line: number; title: string; author: string; similar_to: string }[];
    rejected: { line: number; reason: string }[];
    statuses: { sheet: string; status: string; rows: number }[];
    unreadable: string[];
    temp_files_removed: number;
  };
  scan: ScanResult | null;
}
