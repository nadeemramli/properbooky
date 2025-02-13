import { createClient } from "@/lib/supabase/server";
import { createClient as createDirectClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import type { Book, Highlight } from "@/types/book";
import type { Database } from "@/lib/database.types";

// Create a direct client for static generation
const supabaseUrl = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "";
const supabaseAnonKey = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] ?? "";
const staticClient = createDirectClient<Database>(supabaseUrl, supabaseAnonKey);

// This is required for static site generation with dynamic routes
export async function generateStaticParams() {
  // Return an empty array during static generation
  // This will allow the paths to be generated dynamically at runtime
  // where we have proper authentication
  return [];
}

interface DatabaseHighlight {
  id: string;
  content: string;
  page: number;
  created_at: string;
  tags?: string[];
  book_id: string;
  user_id: string;
  color: string;
  updated_at: string;
}

interface DatabaseBook extends Omit<Book, "highlights"> {
  highlights?: DatabaseHighlight[];
}

export default async function BookProfilePage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();

  try {
    const { data: book, error } = await supabase
      .from("books")
      .select(
        `
        *,
        highlights (
          id,
          content,
          page_number,
          tags,
          created_at
        )
      `
      )
      .eq("id", params.id)
      .single<DatabaseBook>();

    if (error || !book) {
      console.error("Error fetching book:", error);
      notFound();
    }

    // Transform database highlights to match our Highlight type
    const transformedHighlights: Highlight[] =
      book.highlights?.map((highlight: DatabaseHighlight) => ({
        id: highlight.id,
        book_id: highlight.book_id,
        user_id: highlight.user_id,
        content: highlight.content,
        page: highlight.page,
        color: highlight.color || "#FFD700", // Default to gold if no color
        tags: highlight.tags || [],
        created_at: highlight.created_at,
        updated_at: highlight.updated_at,
      })) || [];

    const transformedBook: Book = {
      ...book,
      highlights: transformedHighlights,
    };

    return (
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          {/* Book Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold mb-2">{transformedBook.title}</h1>
            <div className="flex gap-4 text-sm text-gray-600">
              <span>Format: {transformedBook.format}</span>
              <span>Status: {transformedBook.status}</span>
            </div>
          </div>

          {/* Metadata */}
          <div className="bg-gray-50 p-6 rounded-lg mb-8">
            <h2 className="text-xl font-semibold mb-4">Book Details</h2>
            <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Object.entries(transformedBook.metadata || {}).map(
                ([key, value]) => (
                  <div key={key}>
                    <dt className="text-sm font-medium text-gray-500 capitalize">
                      {key}
                    </dt>
                    <dd className="mt-1 text-sm text-gray-900">
                      {value as string}
                    </dd>
                  </div>
                )
              )}
            </dl>
          </div>

          {/* Highlights */}
          <div>
            <h2 className="text-xl font-semibold mb-4">Highlights</h2>
            <div className="space-y-4">
              {transformedBook.highlights?.map((highlight: Highlight) => (
                <div
                  key={highlight.id}
                  className="bg-white p-4 rounded-lg border"
                >
                  <p className="mb-2">{highlight.content}</p>
                  <div className="flex gap-2 text-sm text-gray-500">
                    <span>Page {highlight.page}</span>
                    {highlight.tags?.map((tag) => (
                      <span key={tag} className="bg-gray-100 px-2 py-1 rounded">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  } catch (error) {
    console.error("Error in BookProfilePage:", error);
    notFound();
  }
}
