import { createClient } from "@/lib/supabase/server";

export default async function LibraryPage() {
  const supabase = createClient();

  const { data: books, error } = await supabase
    .from("books")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching books:", error);
    return <div>Error loading library</div>;
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">My Library</h1>
        <button className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded">
          Add Book
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {books?.map((book) => (
          <div
            key={book.id}
            className="border rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="p-4">
              <h3 className="font-semibold text-lg mb-2">{book.title}</h3>
              <div className="text-sm text-gray-600">
                <p>Format: {book.format}</p>
                <p>Status: {book.status}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {books?.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          No books in your library yet
        </div>
      )}
    </div>
  );
}
