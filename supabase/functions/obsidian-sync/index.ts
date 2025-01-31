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

    // Get the request body
    const { action, data } = await req.json()

    switch (action) {
      case 'export':
        // Export highlights to Obsidian format
        const { data: highlights, error: highlightsError } = await supabaseClient
          .from('highlights')
          .select(`
            content,
            page_number,
            tags,
            books(title)
          `)
          .eq('books.user_id', user.id)

        if (highlightsError) throw highlightsError

        // Transform highlights into Markdown
        const markdown = highlights.map(highlight => `
## ${highlight.books.title}

> ${highlight.content}
${highlight.page_number ? `Page: ${highlight.page_number}` : ''}
${highlight.tags?.length ? `Tags: ${highlight.tags.join(', ')}` : ''}
        `).join('\n\n')

        return new Response(markdown, {
          headers: { ...corsHeaders, 'Content-Type': 'text/markdown' },
          status: 200,
        })

      case 'import':
        // Import notes from Obsidian
        // TODO: Implement Obsidian import logic
        throw new Error('Import not yet implemented')

      default:
        throw new Error('Invalid action')
    }
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})