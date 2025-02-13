import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import type { Database } from "@/types/database";
import type { BookCreate, BookStatus, BookMetadata } from "@/types/book";
import type { Json } from "@/types/database";

// Helper function to convert BookMetadata to Json type
function convertMetadataToJson(metadata: Partial<BookMetadata>): Json {
  return JSON.parse(JSON.stringify(metadata));
}

// Note: user_id will be set during setupDefaultBooks
const createDefaultBook = (userId: string): Database["public"]["Tables"]["books"]["Insert"] => ({
  title: "Sample PDF Book",
  author: "ProperBooky Team",
  format: "pdf",
  file_url: "/default-books/sample.pdf", // This will be replaced with actual URL
  cover_url: "/default-books/sample-cover.jpg", // This will be replaced with actual URL
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

export async function setupDefaultBooks(userId: string) {
  if (!userId) {
    console.error("No user ID provided for default books setup");
    return;
  }

  const supabase = createClientComponentClient<Database>();

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
      // User already has books, skip default setup
      return;
    }

    // Create default book with user ID
    const defaultBook = createDefaultBook(userId);

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
      .from("default-books")
      .getPublicUrl("sample-cover.jpg");

    if (!coverData?.publicUrl) {
      console.error("Failed to get cover URL");
      return;
    }

    // Update URLs in the book data
    const bookData: Database["public"]["Tables"]["books"]["Insert"] = {
      ...defaultBook,
      file_url: fileData.publicUrl,
      cover_url: coverData.publicUrl,
    };

    const { error: insertError } = await supabase
      .from("books")
      .insert(bookData);

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