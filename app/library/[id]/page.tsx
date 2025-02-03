import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";

export default async function BookProfilePage({
  params: { id },
}: {
  params: { id: string };
}) {
  const supabase = createClient();

  const { data: book, error } = await supabase
    .from("books")
    .select(
      `
      *,
      highlights (
        id,
        content,
        page_number,
        tags
      )
    `
    )
    .eq("id", id)
    .single();

  if (error || !book) {
    console.error("Error fetching book:", error);
    notFound();
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-4xl mx-auto">
        {/* Book Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">{book.title}</h1>
          <div className="flex gap-4 text-sm text-gray-600">
            <span>Format: {book.format}</span>
            <span>Status: {book.status}</span>
          </div>
        </div>

        {/* Metadata */}
        <div className="bg-gray-50 p-6 rounded-lg mb-8">
          <h2 className="text-xl font-semibold mb-4">Book Details</h2>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(book.metadata || {}).map(([key, value]) => (
              <div key={key}>
                <dt className="text-sm font-medium text-gray-500 capitalize">
                  {key}
                </dt>
                <dd className="mt-1 text-sm text-gray-900">
                  {value as string}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Highlights */}
        <div>
          <h2 className="text-xl font-semibold mb-4">Highlights</h2>
          <div className="space-y-4">
            {book.highlights?.map((highlight) => (
              <div
                key={highlight.id}
                className="bg-white p-4 rounded-lg border"
              >
                <p className="mb-2">{highlight.content}</p>
                <div className="flex gap-2 text-sm text-gray-500">
                  {highlight.page_number && (
                    <span>Page {highlight.page_number}</span>
                  )}
                  {highlight.tags &&
                    (highlight.tags as string[]).map((tag) => (
                      <span key={tag} className="bg-gray-100 px-2 py-1 rounded">
                        {tag}
                      </span>
                    ))}
                </div>
              </div>
            ))}
            {(!book.highlights || book.highlights.length === 0) && (
              <p className="text-gray-500 text-center py-4">
                No highlights added yet
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
