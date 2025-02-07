import type { PDFDocumentProxy } from "pdfjs-dist";

export interface PDFMetadata {
  info?: {
    Title?: string;
    Author?: string;
    Subject?: string;
    Keywords?: string;
    Creator?: string;
    Producer?: string;
    CreationDate?: string;
    ModDate?: string;
    Trapped?: string;
    Publisher?: string;
    Language?: string;
    ISBN?: string;
    [key: string]: string | undefined;
  };
  metadata?: any;
  contentDispositionFilename?: string | null;
}

export type PDFDocumentInfo = NonNullable<PDFMetadata["info"]>;

// Re-export PDFDocumentProxy type for convenience
export type { PDFDocumentProxy }; 