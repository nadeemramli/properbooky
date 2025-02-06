import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isPostgrestError, getErrorMessage } from '@/lib/utils/error'
import type { Book as AppBook, BookCreate, BookUpdate, BookMetadata } from '@/types/book'
import type { Database } from '@/types/database'
import type { Json } from '@/types/database'
import { useAuth } from './use-auth'

type DbBook = Database['public']['Tables']['books']['Row']

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
  const [error, setError] = useState<string | null>(null)
  const supabase = createClient()
  const { user } = useAuth()

  // Fetch books
  const fetchBooks = async () => {
    try {
      if (!user) {
        setBooks([]);
        setError("User not authenticated");
        return;
      }

      setLoading(true)
      const query = supabase
        .from('books')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      const filteredQuery = searchQuery 
        ? query.ilike('title', `%${searchQuery}%`)
        : query;

      const { data, error: queryError } = await filteredQuery;

      if (queryError) throw queryError;
      
      if (!data) {
        setBooks([]);
        return;
      }

      const transformedBooks = data.map((book: DbBook) => transformBook(book));
      setBooks(transformedBooks);
    } catch (err) {
      const errorMessage = getErrorMessage(err);
      setError(errorMessage);
      console.error('Error fetching books:', err);
    } finally {
      setLoading(false)
    }
  }

  // Add book
  const addBook = async (bookData: BookCreate) => {
    try {
      if (!user) {
        throw new Error("User not authenticated");
      }

      const { data, error: insertError } = await supabase
        .from('books')
        .insert({
          title: bookData.title,
          author: bookData.author ?? null,
          format: bookData.format,
          file_url: bookData.file_url,
          cover_url: bookData.cover_url ?? null,
          status: bookData.status ?? 'unread',
          progress: bookData.progress ?? 0,
          priority_score: bookData.priority_score ?? 0,
          user_id: user.id,
          metadata: transformMetadata(bookData.metadata as BookMetadata),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          last_read: null
        })
        .select()
        .single();

      if (insertError) throw insertError;
      if (!data) throw new Error('No data returned from insert');

      const transformedBook = transformBook(data);
      setBooks(prev => [transformedBook, ...prev]);
      return transformedBook;
    } catch (err) {
      const errorMessage = getErrorMessage(err);
      setError(errorMessage);
      throw err;
    }
  }

  // Update book
  const updateBook = async (id: string, updates: BookUpdate) => {
    try {
      if (!user) {
        throw new Error("User not authenticated");
      }

      const updateData: Partial<DbBook> = {
        ...(updates.title && { title: updates.title }),
        ...(updates.author !== undefined && { author: updates.author }),
        ...(updates.format && { format: updates.format }),
        ...(updates.file_url && { file_url: updates.file_url }),
        ...(updates.cover_url !== undefined && { cover_url: updates.cover_url }),
        ...(updates.status && { status: updates.status }),
        ...(updates.progress !== undefined && { progress: updates.progress }),
        ...(updates.priority_score !== undefined && { priority_score: updates.priority_score }),
        ...(updates.metadata && { metadata: transformMetadata(updates.metadata as BookMetadata) }),
        ...(updates.last_read !== undefined && { last_read: updates.last_read }),
        updated_at: new Date().toISOString()
      };

      const { data, error: updateError } = await supabase
        .from('books')
        .update(updateData)
        .eq('id', id)
        .eq('user_id', user.id)
        .select()
        .single();

      if (updateError) throw updateError;
      if (!data) throw new Error('No data returned from update');

      const transformedBook = transformBook(data);
      setBooks(prev => prev.map(book => book.id === id ? transformedBook : book));
      return transformedBook;
    } catch (err) {
      const errorMessage = getErrorMessage(err);
      setError(errorMessage);
      throw err;
    }
  }

  // Delete book
  const deleteBook = async (id: string) => {
    try {
      if (!user) {
        throw new Error("User not authenticated");
      }

      const { error: deleteError } = await supabase
        .from('books')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);

      if (deleteError) throw deleteError;
      setBooks(prev => prev.filter(book => book.id !== id));
    } catch (err) {
      const errorMessage = getErrorMessage(err);
      setError(errorMessage);
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
      setError(errorMessage);
      throw err;
    }
  }

  // Fetch books on mount and when search query changes
  useEffect(() => {
    fetchBooks()
  }, [searchQuery, user])

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