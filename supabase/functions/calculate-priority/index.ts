// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
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

    // Calculate priority scores for all books
    const { data: books, error: booksError } = await supabaseClient
      .from('books')
      .select('id, status, metadata, highlights(count)')
      .eq('user_id', user.id)

    if (booksError) throw booksError

    for (const book of books) {
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
      const metadata = book.metadata || {}
      score += Object.keys(metadata).length

      // Points for engagement (highlights)
      score += book.highlights?.[0]?.count || 0

      // Update the book's priority score
      const { error: updateError } = await supabaseClient
        .from('books')
        .update({ priority_score: score })
        .eq('id', book.id)

      if (updateError) throw updateError
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})