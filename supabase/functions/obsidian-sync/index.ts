// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { Book, ErrorResponse } from "../types"
import { isBook } from "../types/guards"

// Type for the raw highlight data from Supabase
interface RawHighlight {
  id: string;
  text: string;
  note: string | null;
  books: {
    id: string;
    title: string;
    status: 'reading' | 'unread' | 'completed';
    metadata: Record<string, unknown>;
    user_id: string;
    priority_score?: number;
  };
}

// Type for the processed highlight data
interface ObsidianHighlight {
  id: string;
  text: string;
  note?: string;
  book: {
    id: string;
    title: string;
    status: 'reading' | 'unread' | 'completed';
    metadata: Record<string, unknown>;
    user_id: string;
    priority_score?: number;
  };
}

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

    if (!user) {
      throw new Error('No user')
    }

    // Get all highlights with their books
    const { data: highlights, error: highlightsError } = await supabaseClient
      .from('highlights')
      .select(`
        id,
        text,
        note,
        books (
          id,
          title,
          status,
          metadata,
          user_id,
          priority_score
        )
      `)
      .eq('user_id', user.id)

    if (highlightsError) throw highlightsError
    if (!highlights) throw new Error('No highlights found')

    // Convert highlights to Obsidian format
    const markdown = (highlights as unknown as RawHighlight[])
      .filter((highlight): highlight is RawHighlight => 
        highlight.books !== null && 
        typeof highlight.books === 'object' &&
        'title' in highlight.books &&
        'status' in highlight.books &&
        (highlight.books.status === 'reading' || 
         highlight.books.status === 'unread' || 
         highlight.books.status === 'completed'))
      .map(highlight => {
        const book = {
          id: highlight.books.id,
          title: highlight.books.title,
          status: highlight.books.status,
          user_id: highlight.books.user_id,
          metadata: highlight.books.metadata,
          priority_score: highlight.books.priority_score
        }

        const obsidianHighlight: ObsidianHighlight = {
          id: highlight.id,
          text: highlight.text,
          note: highlight.note ?? undefined,
          book
        }

        return `## ${obsidianHighlight.book.title}

> ${obsidianHighlight.text}
${obsidianHighlight.note ? `\n${obsidianHighlight.note}` : ''}`
      }).join('\n\n')

    return new Response(markdown, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/markdown',
        'Content-Disposition': 'attachment; filename="highlights.md"',
      },
      status: 200,
    })
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