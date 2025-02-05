import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { Book, ErrorResponse } from '../types'
import { isBook } from '../types/guards'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    )

    // Get auth user
    const {
      data: { user },
    } = await supabaseClient.auth.getUser()

    if (!user) throw new Error('No user')

    // Get all books for the user
    const { data: booksData, error: booksError } = await supabaseClient
      .from('books')
      .select('*')
      .eq('user_id', user.id)

    if (booksError) throw booksError
    if (!booksData) throw new Error('No books found')

    // Filter and validate books
    const books = booksData.filter(isBook)

    // Calculate mission progress
    const completedBooks = books.filter((book) => book.status === 'completed').length
    const readingBooks = books.filter((book) => book.status === 'reading').length

    // Update user's missions
    const { error: updateError } = await supabaseClient
      .from('user_missions')
      .upsert({
        user_id: user.id,
        completed_books: completedBooks,
        reading_books: readingBooks,
        last_updated: new Date().toISOString(),
      })

    if (updateError) throw updateError

    return new Response(
      JSON.stringify({
        success: true,
        data: { completedBooks, readingBooks },
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error: unknown) {
    const errorResponse: ErrorResponse = {
      error: error instanceof Error ? error.message : 'An unknown error occurred',
      details: error,
    }

    return new Response(JSON.stringify(errorResponse), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
}) 