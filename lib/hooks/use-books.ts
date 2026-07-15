import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import { isPostgrestError, getErrorMessage } from '@/lib/utils/error'
import type { Book as AppBook, BookCreate, BookUpdate, BookMetadata, BookRecommendation, Bookmark, TOCItem, Highlight } from '@/types/book'
import type { Database } from '@/types/database'
import type { Json } from '@/types/database'
import { useAuth } from './use-auth'

type DbBook = Database['public']['Tables']['books']['Row']
type BookStatus = "unread" | "reading" | "completed" | "wishlist";

// Transform database book to application book
const transformBook = (book: DbBook): AppBook => {
  const metadata = book.metadata as BookMetadata;
  
  // Helper function to convert complex objects to JSON-safe format
  const toJsonSafe = <T extends object>(obj: T): T => {
    return JSON.parse(JSON.stringify(obj)) as T;
  };

  return {
    id: book.id,
    title: book.title,
    author: book.author ?? undefined,
    format: book.format,  // Already matches the type
    file_url: book.file_url,  // Already matches the type
    cover_url: book.cover_url ?? undefined,
    status: book.status,
    progress: book.progress ?? null,
    last_read: book.last_read ?? null,
    created_at: book.created_at,
    updated_at: book.updated_at,
    // These are stored inside the metadata jsonb column, not as book columns.
    publication_year: metadata?.publication_year ?? null,
    knowledge_spectrum: metadata?.knowledge_spectrum ?? null,
    manual_rating: metadata?.manual_rating ?? null,
    wishlist_priority: metadata?.wishlist_priority ?? null,
    wishlist_notes: metadata?.wishlist_notes ?? null,
    priority_score: book.priority_score ?? null,
    size: metadata?.size ?? null,
    pages: metadata?.pages ?? null,
    user_id: book.user_id,
    metadata: {
      publisher: metadata?.publisher ?? "",
      published_date: metadata?.published_date ?? "",
      language: metadata?.language ?? "en",
      pages: metadata?.pages ?? 0,
      isbn: metadata?.isbn ?? "",
      description: metadata?.description ?? "",
      ...metadata,
      // Convert complex objects to JSON-safe format
      recommendations: metadata?.recommendations ? toJsonSafe<BookRecommendation[]>(metadata.recommendations) : undefined,
      bookmarks: metadata?.bookmarks ? toJsonSafe<Bookmark[]>(metadata.bookmarks) : undefined,
      toc: metadata?.toc ? toJsonSafe<TOCItem[]>(metadata.toc) : undefined,
      highlights: metadata?.highlights ? toJsonSafe<Highlight[]>(metadata.highlights) : undefined,
    }
  }
}

// Transform metadata for database operations.
// Preserve every field the caller passed — the previous allow-list silently
// dropped anything it didn't enumerate (recommendations, bookmarks, toc, ...),
// which wiped stored metadata on any partial update. JSON round-tripping keeps
// the value JSON-safe and naturally strips `undefined` keys.
const transformMetadata = (metadata: BookMetadata | undefined): Json => {
  if (!metadata) return {} as Json;

  return JSON.parse(
    JSON.stringify({
      ...metadata,
      language: metadata.language || "en",
    })
  ) as Json;
}

export function useBooks(searchQuery?: string) {
  const [books, setBooks] = useState<AppBook[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  // Memoize the client so hook callbacks keep a stable identity across renders.
  // A fresh client every render made getBook/updateBook change identity, which
  // re-fired consumer effects that depend on them (e.g. the reader page's
  // fetch-on-getBook effect looped indefinitely).
  const supabase = useMemo(() => createClientComponentClient<Database>(), [])
  const { user, isAuthenticated, loading: authLoading } = useAuth()

  const fetchBooks = useCallback(async () => {
    try {
      // Clear any previous errors
      setError(null);
      
      // Don't fetch if auth is still loading
      if (authLoading) {
        return;
      }

      // Only set error if auth is done loading and user is not authenticated
      if (!authLoading && (!isAuthenticated || !user?.id)) {
        setBooks([]);
        setError(new Error("User not authenticated"));
        return;
      }

      setLoading(true)
      let query = supabase
        .from('books')
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false })

      if (searchQuery) {
        query = query.ilike('title', `%${searchQuery}%`)
      }

      const { data, error: queryError } = await query;

      if (queryError) throw queryError;
      
      if (!data) {
        setBooks([]);
        return;
      }

      const transformedBooks = data.map((book: DbBook) => transformBook(book));
      setBooks(transformedBooks);
    } catch (err) {
      const errorMessage = getErrorMessage(err);
      setError(new Error(errorMessage));
      console.error('Error fetching books:', err);
    } finally {
      setLoading(false)
    }
  }, [searchQuery, user, supabase, authLoading, isAuthenticated])

  // Fetch books when dependencies change
  useEffect(() => {
    fetchBooks();
  }, [fetchBooks]);

  // Add book
  const addBook = async (bookData: BookCreate) => {
    try {
      if (!user) {
        throw new Error("User not authenticated");
      }

      // Validate required fields
      if (!bookData.title) {
        throw new Error("Book title is required");
      }

      // Check for duplicate book
      const { data: existingBook, error: searchError } = await supabase
        .from("books")
        .select("id, title")
        .eq("title", bookData.title)
        .eq("user_id", user.id)
        .maybeSingle();

      if (searchError) {
        console.error("Error checking for duplicate book:", searchError);
        throw new Error("Failed to verify book uniqueness");
      }

      if (existingBook) {
        throw new Error(`A book with the title "${bookData.title}" already exists in your library`);
      }

      // If file_url is provided, verify it exists in storage
      if (bookData.file_url) {
        try {
          const { data: fileExists } = await supabase
            .storage
            .from('books')
            .createSignedUrl(bookData.file_url.split('/').slice(-2).join('/'), 1);

          if (!fileExists) {
            throw new Error("File not found in storage");
          }
        } catch (error) {
          console.error("Error verifying file existence:", error);
          throw new Error("Failed to verify uploaded file");
        }
      }

      // Insert book with transaction to ensure atomicity
      const { data, error: insertError } = await supabase
        .from("books")
        .insert({
          title: bookData.title,
          author: bookData.author,
          format: bookData.format,
          file_url: bookData.file_url,
          cover_url: bookData.cover_url || null,
          status: bookData.status || "unread",
          progress: bookData.progress || 0,
          priority_score: bookData.priority_score || 0,
          metadata: transformMetadata(bookData.metadata as BookMetadata),
          last_read: null,
          user_id: user.id,
        } as Database["public"]["Tables"]["books"]["Insert"])
        .select()
        .single();

      if (insertError) {
        console.error("Error inserting book:", insertError);
        throw new Error("Failed to add book to database");
      }

      if (!data) {
        throw new Error("No data returned after inserting book");
      }

      const transformedBook = transformBook(data as DbBook);
      setBooks(prev => [transformedBook, ...prev]);
      return transformedBook;
    } catch (err) {
      const errorMessage = getErrorMessage(err);
      setError(new Error(errorMessage));
      throw err;
    }
  }

  // Update book
  const updateBook = useCallback(async (id: string, updates: BookUpdate) => {
    try {
      if (!user) {
        throw new Error("User not authenticated");
      }

      // Several "book" fields (publication_year, ratings, wishlist_*, size,
      // pages) live inside the metadata jsonb column, not as real columns.
      // Pull them out of the top-level payload and fold them into metadata so
      // we never attempt to update a column that doesn't exist.
      const {
        metadata: metadataUpdate,
        publication_year,
        knowledge_spectrum,
        manual_rating,
        wishlist_priority,
        wishlist_notes,
        ...columnUpdates
      } = updates;

      const virtualMetadata: Partial<BookMetadata> = {};
      if (publication_year !== undefined)
        virtualMetadata.publication_year = publication_year ?? undefined;
      if (knowledge_spectrum !== undefined)
        virtualMetadata.knowledge_spectrum = knowledge_spectrum ?? undefined;
      if (manual_rating !== undefined)
        virtualMetadata.manual_rating = manual_rating ?? undefined;
      if (wishlist_priority !== undefined)
        virtualMetadata.wishlist_priority = wishlist_priority ?? undefined;
      if (wishlist_notes !== undefined)
        virtualMetadata.wishlist_notes = wishlist_notes ?? undefined;

      const hasMetadataChange =
        metadataUpdate !== undefined || Object.keys(virtualMetadata).length > 0;

      const payload: Record<string, unknown> = { ...columnUpdates };

      if (hasMetadataChange) {
        // Merge partial metadata over the current stored value so we never
        // clobber fields the caller didn't touch (highlights, bookmarks, toc…).
        const { data: current, error: fetchError } = await supabase
          .from("books")
          .select("metadata")
          .eq("id", id)
          .eq("user_id", user.id)
          .single();

        if (fetchError) throw fetchError;

        const currentMetadata = (current?.metadata ?? {}) as BookMetadata;
        const mergedMetadata: BookMetadata = {
          ...currentMetadata,
          ...(metadataUpdate ?? {}),
          ...virtualMetadata,
        };
        payload.metadata = transformMetadata(mergedMetadata);
      }

      const { data, error } = await supabase
        .from("books")
        .update(payload)
        .eq("id", id)
        .eq("user_id", user.id)
        .select()
        .single();

      if (error) throw error;

      const transformedBook = transformBook(data as DbBook);
      setBooks(prev => prev.map(book => book.id === id ? transformedBook : book));
      return transformedBook;
    } catch (err) {
      const errorMessage = getErrorMessage(err);
      setError(new Error(errorMessage));
      throw err;
    }
  }, [user, supabase])

  // Delete book
  const deleteBook = async (id: string) => {
    try {
      if (!user) {
        throw new Error("User not authenticated");
      }

      const { error } = await supabase
        .from('books')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);

      if (error) throw error;
      setBooks(prev => prev.filter(book => book.id !== id));
    } catch (err) {
      const errorMessage = getErrorMessage(err);
      setError(new Error(errorMessage));
      throw err;
    }
  }

  // Upload book file
  const uploadBookFile = async (file: File) => {
    try {
      if (!user) {
        throw new Error("User not authenticated");
      }

      // Validate file
      if (!file) {
        throw new Error("No file provided");
      }

      if (file.size > 100 * 1024 * 1024) { // 100MB limit
        throw new Error("File size must be less than 100MB");
      }

      const allowedTypes = ['application/pdf', 'application/epub+zip'];
      if (!allowedTypes.includes(file.type)) {
        throw new Error("Only PDF and EPUB files are allowed");
      }

      // Generate unique filename
      const fileExt = file.name.split('.').pop()?.toLowerCase();
      const uniqueId = Math.random().toString(36).substring(2);
      const fileName = `${uniqueId}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      const filePath = `${user.id}/${fileName}`;

      // Upload file with progress tracking
      const { error: uploadError } = await supabase
        .storage
        .from('books')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) {
        console.error("Error uploading file:", uploadError);
        throw new Error("Failed to upload file");
      }

      // Verify upload and get URL
      const { data: { publicUrl } } = supabase
        .storage
        .from('books')
        .getPublicUrl(filePath);

      // Verify the file exists
      const { data: fileExists } = await supabase
        .storage
        .from('books')
        .createSignedUrl(filePath, 1);

      if (!fileExists) {
        throw new Error("File upload verification failed");
      }

      return publicUrl;
    } catch (err) {
      const errorMessage = getErrorMessage(err);
      setError(new Error(errorMessage));
      throw err;
    }
  }

  const getBook = useCallback(async (id: string): Promise<AppBook> => {
    const { data, error } = await supabase
      .from("books")
      .select("*")
      .eq("id", id)
      .single();

    if (error) throw error;
    if (!data) throw new Error("Book not found");

    return transformBook(data as DbBook);
  }, [supabase])

  return {
    books,
    loading,
    error,
    addBook,
    updateBook,
    deleteBook,
    uploadBookFile,
    getBook,
    refreshBooks: fetchBooks
  }
} 