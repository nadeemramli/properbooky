import { createClient } from "@/lib/supabase/client";
import { BookUpload } from "../types";

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const ALLOWED_TYPES = {
  "application/pdf": "pdf",
  "application/epub+zip": "epub",
};

export class FileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileValidationError";
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
    const pdfHeader = String.fromCharCode(...bytes);
    if (!pdfHeader.startsWith("%PDF-")) {
      throw new FileValidationError("Invalid PDF file");
    }
  }

  // Additional validation for EPUB files
  if (file.type === "application/epub+zip") {
    // Check for .epub extension
    if (!file.name.toLowerCase().endsWith(".epub")) {
      throw new FileValidationError("Invalid EPUB file");
    }
  }
}

export async function compressFile(file: File): Promise<File> {
  if (file.type === "application/pdf") {
    // For PDFs, we'll use the pdf-lib library to compress
    const { PDFDocument } = await import("pdf-lib");
    const arrayBuffer = await file.arrayBuffer();
    const pdfDoc = await PDFDocument.load(arrayBuffer);
    
    // Compress PDF
    const compressedPdfBytes = await pdfDoc.save({
      useObjectStreams: true,
      addDefaultPage: false,
      useCompression: true,
    });

    return new File([compressedPdfBytes], file.name, {
      type: "application/pdf",
    });
  }

  // For EPUBs, we'll keep the original file for now
  // TODO: Implement EPUB compression if needed
  return file;
}

export async function uploadBookFile(
  file: File,
  userId: string
): Promise<BookUpload> {
  try {
    // Validate file
    await validateFile(file);

    // Compress file
    const compressedFile = await compressFile(file);

    // Generate a unique file name
    const timestamp = Date.now();
    const fileExtension = ALLOWED_TYPES[file.type as keyof typeof ALLOWED_TYPES];
    const fileName = `${timestamp}-${file.name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")}.${fileExtension}`;

    // Upload to Supabase Storage
    const supabase = createClient();
    const { data, error } = await supabase.storage
      .from("books")
      .upload(`${userId}/${fileName}`, compressedFile, {
        cacheControl: "3600",
        upsert: false,
      });

    if (error) throw error;

    // Get the public URL
    const { data: publicUrl } = supabase.storage
      .from("books")
      .getPublicUrl(`${userId}/${fileName}`);

    return {
      file: compressedFile,
      format: fileExtension as "epub" | "pdf",
      file_url: publicUrl.publicUrl,
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