import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Book } from '@/types/book'

export function useBooks(searchQuery?: string) {
  const [books, setBooks] = useState<Book[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const supabase = createClient()

  // Fetch books
  const fetchBooks = async () => {
    try {
      setLoading(true)
      let query = supabase
        .from('books')
        .select('*')
        .order('created_at', { ascending: false })

      if (searchQuery) {
        query = query.ilike('title', `%${searchQuery}%`)
      }

      const { data, error } = await query

      if (error) throw error
      setBooks(data || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  // Add book
  const addBook = async (bookData: Omit<Book, 'id'>) => {
    try {
      const { data, error } = await supabase
        .from('books')
        .insert([bookData])
        .select()
        .single()

      if (error) throw error
      setBooks(prev => [data, ...prev])
      return data
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error adding book')
      throw err
    }
  }

  // Update book
  const updateBook = async (id: string, updates: Partial<Book>) => {
    try {
      const { data, error } = await supabase
        .from('books')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      setBooks(prev => prev.map(book => book.id === id ? data : book))
      return data
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error updating book')
      throw err
    }
  }

  // Delete book
  const deleteBook = async (id: string) => {
    try {
      const { error } = await supabase
        .from('books')
        .delete()
        .eq('id', id)

      if (error) throw error
      setBooks(prev => prev.filter(book => book.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error deleting book')
      throw err
    }
  }

  // Upload book file
  const uploadBookFile = async (file: File) => {
    try {
      const fileExt = file.name.split('.').pop()
      const fileName = `${Math.random()}.${fileExt}`
      const filePath = `${fileName}`

      const { error: uploadError } = await supabase
        .storage
        .from('books')
        .upload(filePath, file)

      if (uploadError) throw uploadError

      return filePath
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error uploading file')
      throw err
    }
  }

  // Fetch books on mount and when search query changes
  useEffect(() => {
    fetchBooks()
  }, [searchQuery])

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