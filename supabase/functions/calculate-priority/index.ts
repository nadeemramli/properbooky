// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import type { Book, ErrorResponse, SuccessResponse } from "../types"
import { isBook } from "../types/guards"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function calculateBookScore(book: Book): number {
  let score = 0

  // Base score from status
  switch (book.status) {
    case 'reading':
      score += 10
      break
    case 'unread':
      score += 5
      break
    case 'completed':
      score += 1
      break
  }

  // Bonus points for metadata completeness
  score += Object.keys(book.metadata || {}).length

  // Points for engagement (highlights)
  score += book.highlights?.reduce((sum, highlight) => sum + highlight.count, 0) || 0

  return score
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

    if (!user) {
      throw new Error('No user')
    }

    // Get all books for the user with their highlights
    const { data: booksData, error: booksError } = await supabaseClient
      .from('books')
      .select(`
        id,
        title,
        status,
        metadata,
        user_id,
        highlights (
          id,
          book_id,
          count
        )
      `)
      .eq('user_id', user.id)

    if (booksError) throw booksError
    if (!booksData) throw new Error('No books found')

    // Type guard to ensure we have valid book data
    const books = booksData.filter(isBook)

    // Calculate and update priority scores
    const updatePromises = books.map(async (book) => {
      const score = calculateBookScore(book)
      const { error: updateError } = await supabaseClient
        .from('books')
        .update({ priority_score: score })
        .eq('id', book.id)

      if (updateError) throw updateError
    })

    await Promise.all(updatePromises)

    const response: SuccessResponse = { 
      success: true,
      data: { updatedBooks: books.length }
    }

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error: unknown) {
    const errorResponse: ErrorResponse = { 
      error: error instanceof Error ? error.message : 'An unknown error occurred',
      details: error
    }

    return new Response(JSON.stringify(errorResponse), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})