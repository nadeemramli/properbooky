import { createClient } from "@/lib/supabase/client";
import type { BookUpload, BookFormat, BookMetadata } from "../types";
import type { FileProgress } from "@/types";
import pdfjs from "pdfjs-dist";
import * as epubjs from "epubjs";

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const ALLOWED_TYPES: Record<string, BookFormat> = {
  "application/pdf": "pdf",
  "application/epub+zip": "epub",
};

export class FileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileValidationError";
  }
}

/**
 * Extract metadata from a PDF file
 */
async function extractPDFMetadata(file: File): Promise<Partial<BookMetadata>> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const metadata = await pdf.getMetadata();

  return {
    title: metadata.info?.Title,
    author: metadata.info?.Author,
    publisher: metadata.info?.Publisher,
    published_date: metadata.info?.CreationDate,
    language: metadata.info?.Language,
    pages: pdf.numPages,
    isbn: metadata.info?.ISBN,
    description: metadata.info?.Subject,
  };
}

/**
 * Extract metadata from an EPUB file
 */
async function extractEPUBMetadata(file: File): Promise<Partial<BookMetadata>> {
  const book = epubjs.default();
  await book.open(file);
  const metadata = book.package.metadata;

  return {
    title: metadata.title,
    author: metadata.creator,
    publisher: metadata.publisher,
    published_date: metadata.date,
    language: metadata.language,
    description: metadata.description,
    isbn: metadata.identifier,
  };
}

/**
 * Test the connection to Supabase Storage
 * @returns Promise<boolean> true if connection is successful
 */
export async function testStorageConnection(): Promise<boolean> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase.storage.from("books").list();
    if (error) throw error;
    return true;
  } catch (error) {
    console.error("Storage connection test failed:", error);
    return false;
  }
}

export async function validateFile(file: File): Promise<void> {
  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    throw new FileValidationError(
      `File size must be less than ${MAX_FILE_SIZE / 1024 / 1024}MB`
    );
  }

  // Check file type
  if (!Object.keys(ALLOWED_TYPES).includes(file.type)) {
    throw new FileValidationError(
      "Invalid file type. Only PDF and EPUB files are allowed."
    );
  }

  // Additional validation for PDF files
  if (file.type === "application/pdf") {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer.slice(0, 5));
    const pdfHeader = Array.from(bytes)
      .map((byte) => String.fromCharCode(byte))
      .join("");
    if (!pdfHeader.startsWith("%PDF-")) {
      throw new FileValidationError("Invalid PDF file");
    }
  }

  // Additional validation for EPUB files
  if (file.type === "application/epub+zip") {
    if (!file.name.toLowerCase().endsWith(".epub")) {
      throw new FileValidationError("Invalid EPUB file");
    }
  }
}

export async function compressFile(file: File): Promise<File> {
  if (file.type === "application/pdf") {
    const { PDFDocument } = await import("pdf-lib");
    const arrayBuffer = await file.arrayBuffer();
    const pdfDoc = await PDFDocument.load(arrayBuffer);
    
    const compressedPdfBytes = await pdfDoc.save({
      useObjectStreams: true,
      addDefaultPage: false,
      useCompression: true,
    });

    return new File([compressedPdfBytes], file.name, {
      type: "application/pdf",
    });
  }

  return file;
}

export async function uploadBookFile(
  file: File,
  userId: string,
  onProgress?: (progress: FileProgress) => void
): Promise<BookUpload & { metadata: Partial<BookMetadata> }> {
  try {
    await validateFile(file);
    const compressedFile = await compressFile(file);

    // Extract metadata based on file type
    const metadata =
      file.type === "application/pdf"
        ? await extractPDFMetadata(file)
        : await extractEPUBMetadata(file);

    const timestamp = Date.now();
    const fileType = file.type as keyof typeof ALLOWED_TYPES;
    const fileExtension = ALLOWED_TYPES[fileType];
    
    if (!fileExtension) {
      throw new FileValidationError("Invalid file type");
    }

    const fileName = `${timestamp}-${file.name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")}.${fileExtension}`;

    const supabase = createClient();

    // Upload the file with progress tracking
    const { data, error } = await supabase.storage
      .from("books")
      .upload(`${userId}/${fileName}`, compressedFile, {
        cacheControl: "3600",
        upsert: false,
        onUploadProgress: ({ loaded, total }) => {
          const progress = (loaded / total) * 100;
          onProgress?.({ progress });
        },
      });

    if (error) throw error;

    // Get the public URL
    const { data: publicUrl } = supabase.storage
      .from("books")
      .getPublicUrl(`${userId}/${fileName}`);

    return {
      file: compressedFile,
      format: fileExtension,
      file_url: publicUrl.publicUrl,
      metadata: {
        ...metadata,
        size: compressedFile.size,
      },
    };
  } catch (error) {
    if (error instanceof FileValidationError) {
      throw error;
    }
    console.error("Error uploading file:", error);
    throw new Error("Failed to upload file");
  }
}

export async function deleteBookFile(fileUrl: string): Promise<void> {
  const supabase = createClient();
  const path = fileUrl.split("/").slice(-2).join("/"); // Get userId/fileName
  const { error } = await supabase.storage.from("books").remove([path]);
  if (error) throw error;
} 