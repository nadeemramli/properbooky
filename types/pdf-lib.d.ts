declare module 'pdf-lib' {
  export class PDFDocument {
    static load(bytes: ArrayBuffer): Promise<PDFDocument>;
    save(options?: {
      useObjectStreams?: boolean;
      addDefaultPage?: boolean;
      useCompression?: boolean;
    }): Promise<Uint8Array>;
  }
} 