import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { BookCreate, BookStatus, BookMetadata } from "@/types/book";
import type { Json } from "@/types/database";
import { isDev } from "@/lib/config/development";

// Helper function to convert BookMetadata to Json type
function convertMetadataToJson(metadata: Partial<BookMetadata>): Json {
  return JSON.parse(JSON.stringify(metadata));
}

// Note: user_id will be set during setupDefaultBooks
const createDefaultBook = (userId: string): Database["public"]["Tables"]["books"]["Insert"] => ({
  title: "Sample PDF Book",
  author: "ProperBooky Team",
  format: "pdf",
  file_url: null, // Will be set after upload
  cover_url: null, // Will be set after upload
  status: "unread",
  progress: 0,
  user_id: userId,
  metadata: convertMetadataToJson({
    description: "This is a sample book to help you get started with ProperBooky.",
    publisher: "ProperBooky",
    language: "en",
    pages: 10,
    size: 0,
  }),
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  last_read: null,
  priority_score: 0
});

type BooksClient = Pick<SupabaseClient<Database>, "from" | "storage">;

// The sample book's id is derived from the user id (name-based, UUIDv5
// layout), so concurrent or repeated provisioning collides on the primary key
// and inserts at most one row instead of one per caller.
export async function defaultBookId(userId: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(`properbooky:default-book:sample-pdf:${userId}`)
  );
  const bytes = new Uint8Array(digest).slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Callers in the same page share one in-flight run per user.
const inFlight = new Map<string, Promise<void>>();

export function setupDefaultBooks(userId: string, client?: BooksClient): Promise<void> {
  if (!userId) {
    console.error("No user ID provided for default books setup");
    return Promise.resolve();
  }
  let run = inFlight.get(userId);
  if (!run) {
    run = provisionDefaultBooks(userId, client ?? createClientComponentClient<Database>()).finally(() =>
      inFlight.delete(userId)
    );
    inFlight.set(userId, run);
  }
  return run;
}

async function provisionDefaultBooks(userId: string, supabase: BooksClient) {
  try {
    // First, check if user already has any books
    const { data: existingBooks, error: checkError } = await supabase
      .from("books")
      .select("id")
      .eq("user_id", userId)
      .limit(1);

    if (checkError) {
      console.error("Error checking existing books:", checkError);
      return;
    }

    if (existingBooks && existingBooks.length > 0) {
      return;
    }

    // Create default book with user ID
    const defaultBook = { ...createDefaultBook(userId), id: await defaultBookId(userId) };

    // In development mode, use local files
    if (isDev()) {
      defaultBook.file_url = "/defaults/sample.pdf";
      defaultBook.cover_url = "/defaults/book-cover.jpg";
    } else {
      // Get the source file URL
      const { data: fileData } = await supabase.storage
        .from("default-books")
        .getPublicUrl("sample.pdf");

      if (!fileData?.publicUrl) {
        console.error("Failed to get public URL for default book");
        return;
      }

      // Get the cover URL
      const { data: coverData } = await supabase.storage
        .from("default-covers")
        .getPublicUrl("sample-cover.jpg");

      if (!coverData?.publicUrl) {
        console.error("Failed to get cover URL");
        return;
      }

      defaultBook.file_url = fileData.publicUrl;
      defaultBook.cover_url = coverData.publicUrl;
    }

    // Another tab or an earlier run may have inserted it already.
    const { error: insertError } = await supabase
      .from("books")
      .upsert(defaultBook, { onConflict: "id", ignoreDuplicates: true });

    if (insertError) {
      console.error("Error inserting default book:", insertError);
      return;
    }

  } catch (error) {
    console.error("Error setting up default books:", error);
  }
}

export async function ensureDevUserHasBooks() {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  const devUserId = process.env.NEXT_PUBLIC_DEV_USER_ID;

  if (!devUserId) {
    console.warn("No dev user ID configured");
    return;
  }

  try {
    await setupDefaultBooks(devUserId);
  } catch (error) {
    console.error("Error ensuring dev user has books:", error);
  }
} 