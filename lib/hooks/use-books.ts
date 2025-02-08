import { useState, useEffect, useCallback } from 'react'
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import { isPostgrestError, getErrorMessage } from '@/lib/utils/error'
import type { Book as AppBook, BookCreate, BookUpdate, BookMetadata } from '@/types/book'
import type { Database } from '@/types/database'
import type { Json } from '@/types/database'
import { useAuth } from './use-auth'

type DbBook = Database['public']['Tables']['books']['Row']
type BookStatus = "unread" | "reading" | "completed" | "wishlist";

// Transform database book to application book
const transformBook = (book: DbBook): AppBook => {
  const metadata = book.metadata as BookMetadata;
  return {
    ...book,
    metadata: {
      publisher: metadata?.publisher ?? "",
      published_date: metadata?.published_date ?? "",
      language: metadata?.language ?? "en",
      pages: metadata?.pages ?? 0,
      isbn: metadata?.isbn ?? "",
      description: metadata?.description ?? "",
      ...metadata
    }
  }
}

// Transform metadata for database operations
const transformMetadata = (metadata: BookMetadata | undefined): Json => {
  if (!metadata) return {} as Json;
  
  const transformedMetadata: Record<string, Json | undefined> = {
    publisher: metadata.publisher || null,
    published_date: metadata.published_date || null,
    language: metadata.language || "en",
    pages: metadata.pages || null,
    isbn: metadata.isbn || null,
    description: metadata.description || null,
    wishlist_reason: metadata.wishlist_reason || null,
    wishlist_source: metadata.wishlist_source || null,
    wishlist_priority: metadata.wishlist_priority || null,
    wishlist_added_date: metadata.wishlist_added_date || null,
    notes: metadata.notes || null,
    goodreads_url: metadata.goodreads_url || null,
    amazon_url: metadata.amazon_url || null,
    recommendation: metadata.recommendation || null,
    categories: metadata.categories || null,
    tags: metadata.tags || null,
    cover_url: metadata.cover_url || null,
    size: metadata.size || null,
    title: metadata.title || null,
    author: metadata.author || null,
    recommendations: metadata.recommendations?.map(rec => ({
      id: rec.id,
      book_id: rec.book_id,
      user_id: rec.user_id,
      recommender_name: rec.recommender_name,
      recommendation_text: rec.recommendation_text,
      created_at: rec.created_at,
      updated_at: rec.updated_at,
    })) || null,
  };

  return transformedMetadata as Json;
}

export function useBooks(searchQuery?: string) {
  const [books, setBooks] = useState<AppBook[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const supabase = createClientComponentClient<Database>()
  const { user, isAuthenticated, loading: authLoading } = useAuth()

  const fetchBooks = useCallback(async () => {
    try {
      // Don't fetch if auth is still loading
      if (authLoading) {
        return;
      }

      console.log('Auth Debug:', { 
        isAuthenticated, 
        user: user ? { 
          id: user.id, 
          email: user.email,
          role: user.role 
        } : null,
        env: process.env.NODE_ENV,
        authLoading
      });

      if (!isAuthenticated || !user?.id) {
        setBooks([]);
        setError(new Error("User not authenticated"));
        return;
      }

      setLoading(true)
      let query = supabase
        .from('books')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      console.log('Query Debug:', {
        userId: user.id,
        authState: { isAuthenticated, authLoading }
      });

      if (searchQuery) {
        query = query.ilike('title', `%${searchQuery}%`)
      }

      const { data, error: queryError } = await query;

      console.log('Query Result:', {
        success: !queryError,
        error: queryError,
        dataLength: data?.length ?? 0
      });

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
  }, [searchQuery, user, supabase, authLoading])

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
  const updateBook = async (id: string, updates: BookUpdate) => {
    try {
      if (!user) {
        throw new Error("User not authenticated");
      }

      const { data, error } = await supabase
        .from("books")
        .update({
          ...updates,
          metadata:
            updates.metadata &&
            transformMetadata(updates.metadata as BookMetadata),
        })
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
  }

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

  // Fetch books on mount and when search query changes
  useEffect(() => {
    fetchBooks()
  }, [fetchBooks])

  return {
    books,
    loading,
    error,
    addBook,
    updateBook,
    deleteBook,
    uploadBookFile,
    refreshBooks: fetchBooks
  }
} 