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
  if (!metadata) return {};
  return {
    publisher: metadata.publisher ?? "",
    published_date: metadata.published_date ?? "",
    language: metadata.language ?? "en",
    pages: metadata.pages ?? 0,
    isbn: metadata.isbn ?? "",
    description: metadata.description ?? "",
    ...metadata
  };
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

      const { data: existingBook, error: searchError } = await supabase
        .from("books")
        .select("id")
        .eq("title", bookData.title)
        .maybeSingle();

      if (searchError) throw searchError;

      if (existingBook) {
        throw new Error("A book with this title already exists");
      }

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
          metadata: bookData.metadata || {},
          last_read: null,
        } as Database["public"]["Tables"]["books"]["Insert"])
        .select()
        .single();

      if (insertError) throw insertError;

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
        .update(updates as Database["public"]["Tables"]["books"]["Update"])
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

      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random()}.${fileExt}`;
      const filePath = `${user.id}/${fileName}`;

      const { error: uploadError } = await supabase
        .storage
        .from('books')
        .upload(filePath, file);

      if (uploadError) throw uploadError;
      
      const { data: { publicUrl } } = supabase
        .storage
        .from('books')
        .getPublicUrl(filePath);

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