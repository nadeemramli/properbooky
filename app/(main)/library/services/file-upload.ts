import { createClient } from "@/lib/supabase/client";
import type { BookUpload, BookFormat, BookMetadata } from "../types";
import type { FileProgress } from "@/types";
import type { PDFMetadata, PDFDocumentProxy } from "@/types/pdf";
import type { EPUBBook, PackagingMetadataObject } from "@/types/epub";
import pdfjs from "pdfjs-dist";
import * as epubjs from "epubjs";

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const STORAGE_BUCKET = 'books' as const;
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

// Title cleanup helper function
function cleanupTitle(title: string): string {
  return title
    // Remove file extensions
    .replace(/\.(epub|pdf)$/i, '')
    // Replace underscores and hyphens with spaces
    .replace(/[_-]/g, ' ')
    // Remove common prefixes/suffixes
    .replace(/^(book|ebook|audiobook)[\s-]*/i, '')
    // Remove common brackets and their contents
    .replace(/\[(.*?)\]|\((.*?)\)/g, '')
    // Remove multiple spaces
    .replace(/\s+/g, ' ')
    // Capitalize first letter of each word, handling apostrophes correctly
    .split(' ')
    .map(word => {
      if (word.length === 0) return word;
      // Don't capitalize articles, conjunctions, and prepositions unless they're the first word
      const lowercaseWords = ['a', 'an', 'the', 'and', 'but', 'or', 'for', 'nor', 'on', 'at', 'to', 'by', 'in', 'of'];
      if (lowercaseWords.includes(word.toLowerCase())) return word.toLowerCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ')
    .trim();
}

// Author cleanup helper function
function cleanupAuthor(author: string): string {
  return author
    // Remove parentheses and their contents
    .replace(/\([^)]*\)/g, '')
    // Remove brackets and their contents
    .replace(/\[[^\]]*\]/g, '')
    // Replace multiple spaces
    .replace(/\s+/g, ' ')
    // Capitalize each word
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
    .trim();
}

/**
 * Extract metadata from a PDF file
 */
async function extractPDFMetadata(file: File): Promise<{
  metadata: Partial<BookMetadata>;
  publication_year?: number;
}> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    const metadata = await pdf.getMetadata() as PDFMetadata;

    let title = metadata.info?.Title || file.name;
    let author = metadata.info?.Author || undefined;
    const pages = pdf.numPages;

    // Clean up title and author
    title = cleanupTitle(title);
    author = author ? cleanupAuthor(author) : undefined;

    // Try to extract publication year from metadata
    let publication_year: number | undefined;
    if (metadata.info?.CreationDate) {
      const match = metadata.info.CreationDate.match(/D:(\d{4})/);
      if (match?.[1]) {
        publication_year = parseInt(match[1], 10);
      }
    }

    const extractedMetadata: Partial<BookMetadata> = {
      title,
      author,
      publisher: metadata.info?.Publisher || undefined,
      language: metadata.info?.Language || undefined,
      pages,
      isbn: metadata.info?.ISBN || undefined,
      description: metadata.info?.Subject || undefined,
    };

    return {
      metadata: extractedMetadata,
      publication_year,
    };
  } catch (error) {
    console.error("Error extracting PDF metadata:", error);
    return {
      metadata: {
        title: cleanupTitle(file.name),
      },
      publication_year: undefined,
    };
  }
}

/**
 * Extract metadata from an EPUB file
 */
async function extractEPUBMetadata(file: File): Promise<{
  metadata: Partial<BookMetadata>;
  publication_year?: number;
}> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const book = epubjs.default();
    await book.open(arrayBuffer);

    const metadata = book.packaging?.metadata as PackagingMetadataObject || {};

    // Clean up resources
    await book.destroy();

    let title = metadata.title || file.name;
    let author = metadata.creator || undefined;

    // Clean up title and author
    title = cleanupTitle(title);
    author = author ? cleanupAuthor(author) : undefined;

    // Get page count (estimated from navigation)
    const pages = book.navigation?.toc?.length;

    // Try to extract publication year
    let publication_year: number | undefined;
    if (metadata.pubdate) {
      const match = metadata.pubdate.match(/(\d{4})/);
      if (match?.[1]) {
        publication_year = parseInt(match[1], 10);
      }
    }

    const extractedMetadata: Partial<BookMetadata> = {
      title,
      author,
      publisher: metadata.publisher || undefined,
      language: metadata.language || undefined,
      pages: pages || undefined,
      description: metadata.description || undefined,
      isbn: metadata.identifier || undefined,
    };

    return {
      metadata: extractedMetadata,
      publication_year,
    };
  } catch (error) {
    console.error("Error extracting EPUB metadata:", error);
    return {
      metadata: {
        title: cleanupTitle(file.name),
      },
      publication_year: undefined,
    };
  }
}

/**
 * Extract cover image from PDF
 */
async function extractPDFCover(file: File): Promise<string | null> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1.0 });
    
    // Create canvas
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return null;

    // Set canvas dimensions to match page
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    // Render PDF page to canvas
    await page.render({
      canvasContext: context,
      viewport: viewport
    }).promise;

    // Convert canvas to blob
    const blob = await new Promise<Blob | null>(resolve => {
      canvas.toBlob(resolve, 'image/jpeg', 0.75);
    });

    if (!blob) return null;

    // Upload cover image to storage
    const supabase = createClient();
    const coverFileName = `covers/${Date.now()}-cover.jpg`;
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(coverFileName, blob, {
        contentType: 'image/jpeg',
        upsert: false
      });

    if (uploadError) {
      console.error('Error uploading cover:', uploadError);
      return null;
    }

    // Get public URL for cover
    const { data: { publicUrl } } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(coverFileName);

    return publicUrl;
  } catch (error) {
    console.error('Error extracting PDF cover:', error);
    return null;
  }
}

/**
 * Extract cover image from EPUB
 */
async function extractEPUBCover(file: File): Promise<string | null> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const book = epubjs.default();
    await book.open(arrayBuffer);

    // Try to get cover from metadata
    const coverUrl = await book.coverUrl();
    
    if (!coverUrl) {
      await book.destroy();
      return null;
    }

    // Fetch cover image
    const response = await fetch(coverUrl);
    const blob = await response.blob();

    // Upload cover image to storage
    const supabase = createClient();
    const coverFileName = `covers/${Date.now()}-cover.jpg`;
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(coverFileName, blob, {
        contentType: 'image/jpeg',
        upsert: false
      });

    if (uploadError) {
      console.error('Error uploading cover:', uploadError);
      return null;
    }

    // Get public URL for cover
    const { data: { publicUrl } } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(coverFileName);

    await book.destroy();
    return publicUrl;
  } catch (error) {
    console.error('Error extracting EPUB cover:', error);
    return null;
  }
}

/**
 * Test the connection to Supabase Storage
 */
export async function testStorageConnection(): Promise<boolean> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase.storage.from(STORAGE_BUCKET).list();
    if (error) {
      console.error("Storage connection test error:", error);
      if (error.message.includes("Bucket not found")) {
        throw new Error(`Storage bucket '${STORAGE_BUCKET}' not found. Please ensure the storage bucket is properly configured.`);
      }
      throw error;
    }
    return true;
  } catch (error) {
    console.error("Storage connection test failed:", error);
    return false;
  }
}

/**
 * Validate file size and type
 */
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
    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer.slice(0, 5));
      const pdfHeader = Array.from(bytes)
        .map((byte) => String.fromCharCode(byte))
        .join("");
      if (!pdfHeader.startsWith("%PDF-")) {
        throw new FileValidationError("Invalid PDF file");
      }
    } catch (error) {
      throw new FileValidationError("Failed to validate PDF file");
    }
  }

  // Additional validation for EPUB files
  if (file.type === "application/epub+zip") {
    if (!file.name.toLowerCase().endsWith(".epub")) {
      throw new FileValidationError("Invalid EPUB file");
    }
  }
}

/**
 * Compress PDF files to reduce size
 */
export async function compressFile(file: File): Promise<File> {
  if (file.type === "application/pdf") {
    try {
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
    } catch (error) {
      console.error("Error compressing PDF:", error);
      return file;
    }
  }

  return file;
}

export interface UploadProgress {
  bytesTransferred: number;
  totalBytes: number;
  progress: number;
}

/**
 * Upload a book file to storage and extract metadata
 */
export async function uploadBookFile(
  file: File,
  userId: string,
  onProgress?: (progress: UploadProgress) => void
): Promise<BookUpload> {
  try {
    // Validate file first
    await validateFile(file);
    
    // Update progress
    onProgress?.({
      bytesTransferred: 0,
      totalBytes: file.size,
      progress: 0
    });

    // Test storage connection before proceeding
    const isConnected = await testStorageConnection();
    if (!isConnected) {
      throw new Error("Storage system is not properly configured. Please contact support.");
    }

    // Compress file if needed
    const compressedFile = await compressFile(file);
    
    // Update progress after compression
    onProgress?.({
      bytesTransferred: Math.floor(file.size * 0.2),
      totalBytes: file.size,
      progress: 20
    });

    // Extract cover image based on file type
    const coverUrl = file.type === "application/pdf"
      ? await extractPDFCover(file)
      : await extractEPUBCover(file);

    // Update progress after cover extraction
    onProgress?.({
      bytesTransferred: Math.floor(file.size * 0.3),
      totalBytes: file.size,
      progress: 30
    });

    // Extract metadata based on file type
    const { metadata, publication_year } = file.type === "application/pdf"
      ? await extractPDFMetadata(file)
      : await extractEPUBMetadata(file);

    // Update progress after metadata extraction
    onProgress?.({
      bytesTransferred: Math.floor(file.size * 0.4),
      totalBytes: file.size,
      progress: 40
    });

    const timestamp = Date.now();
    const fileType = file.type as keyof typeof ALLOWED_TYPES;
    const fileExtension = ALLOWED_TYPES[fileType];
    
    if (!fileExtension) {
      throw new FileValidationError("Invalid file type");
    }

    // Sanitize filename to ensure it's URL-safe
    const sanitizedFileName = file.name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")
      .replace(/-+/g, "-");

    const fileName = `${timestamp}-${sanitizedFileName}.${fileExtension}`;
    const filePath = `${userId}/${fileName}`;

    const supabase = createClient();

    // Update progress before upload
    onProgress?.({
      bytesTransferred: Math.floor(file.size * 0.6),
      totalBytes: file.size,
      progress: 60
    });

    // Upload the file with retries
    let uploadAttempts = 0;
    const maxAttempts = 3;
    let uploadError: Error | null = null;

    while (uploadAttempts < maxAttempts) {
      try {
        const { data, error } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(filePath, compressedFile, {
            cacheControl: "3600",
            contentType: file.type,
            duplex: "half",
            upsert: false,
          });

        if (error) {
          console.error("Upload error:", error);
          if (error.message.includes("Bucket not found")) {
            throw new Error("Storage system is not properly configured. Please contact support.");
          }
          throw error;
        }

        if (!data?.path) {
          throw new Error("Upload failed: No path returned");
        }

        uploadError = null;
        break;
      } catch (error) {
        console.error(`Upload attempt ${uploadAttempts + 1} failed:`, error);
        uploadError = error as Error;
        
        // If it's a bucket error, no need to retry
        if (error instanceof Error && error.message.includes("Storage system is not properly configured")) {
          throw error;
        }
        
        uploadAttempts++;
        if (uploadAttempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 1000 * uploadAttempts));
        }
      }
    }

    if (uploadError) {
      if (uploadError.message.includes("Bucket not found")) {
        throw new Error("Storage system is not properly configured. Please contact support.");
      }
      throw new Error(`Upload failed after ${maxAttempts} attempts: ${uploadError.message}`);
    }

    // Update progress after upload
    onProgress?.({
      bytesTransferred: Math.floor(file.size * 0.8),
      totalBytes: file.size,
      progress: 80
    });

    // Get the public URL
    const { data: { publicUrl } } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(filePath);

    if (!publicUrl) {
      throw new Error("Failed to get public URL for uploaded file");
    }

    // Verify the file exists
    const { data: fileExists, error: verifyError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(filePath, 60); // 60 seconds validity

    if (verifyError || !fileExists) {
      throw new Error("File upload verification failed");
    }

    // Update progress to complete
    onProgress?.({
      bytesTransferred: file.size,
      totalBytes: file.size,
      progress: 100
    });

    // Return the upload result with the correct type
    const result: BookUpload = {
      file: compressedFile,
      format: fileExtension,
      file_url: publicUrl,
      cover_url: coverUrl,
      metadata: {
        ...metadata,
        size: compressedFile.size,
        pages: metadata.pages || undefined,
        title: metadata.title || cleanupTitle(file.name),
        author: metadata.author || undefined,
        publication_year: publication_year
      },
    };

    return result;
  } catch (error) {
    if (error instanceof FileValidationError) {
      throw error;
    }
    console.error("Error uploading file:", error);
    // Ensure we throw a user-friendly error message
    if (error instanceof Error) {
      if (error.message.includes("Bucket not found") || error.message.includes("Storage system")) {
        throw new Error("Storage system is not properly configured. Please contact support.");
      }
      throw error;
    }
    throw new Error("Failed to upload file. Please try again later.");
  }
}

/**
 * Delete a book file from storage
 */
export async function deleteBookFile(fileUrl: string): Promise<void> {
  try {
    const supabase = createClient();
    const path = fileUrl.split("/").slice(-2).join("/"); // Get userId/fileName
    const { error } = await supabase.storage.from(STORAGE_BUCKET).remove([path]);
    if (error) {
      console.error("Error deleting file:", error);
      if (error.message.includes("Bucket not found")) {
        throw new Error(`Storage bucket '${STORAGE_BUCKET}' not found. Please ensure the storage bucket is properly configured.`);
      }
      throw error;
    }
  } catch (error) {
    console.error("Error deleting file:", error);
    throw new Error("Failed to delete file");
  }
} 