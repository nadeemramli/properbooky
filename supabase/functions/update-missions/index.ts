import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
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
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    )

    // Get auth user
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) throw new Error('No user')

    // Get all active missions
    const { data: missions, error: missionsError } = await supabase
      .from('missions')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'active')

    if (missionsError) throw missionsError

    const now = new Date()

    // Process each mission
    for (const mission of missions) {
      let progress = 0
      let status = mission.status

      // Calculate if mission has expired
      const endDate = mission.end_date ? new Date(mission.end_date) : null
      if (endDate && endDate < now) {
        status = mission.progress >= 100 ? 'completed' : 'paused'
      } else {
        // Calculate progress based on mission type and targets
        const targetBooks = mission.target_books as string[]
        const targetTags = mission.target_tags as string[]

        if (targetBooks.length > 0) {
          // Check progress of specific books
          const { data: completedBooks } = await supabase
            .from('reading_activities')
            .select('book_id')
            .eq('user_id', user.id)
            .eq('type', 'finished')
            .in('book_id', targetBooks)

          progress = Math.min(Math.round(((completedBooks?.length || 0) / targetBooks.length) * 100), 100)
        } else if (targetTags.length > 0) {
          // Check progress of books with specific tags
          const { data: books } = await supabase
            .from('books')
            .select('id, metadata')
            .eq('user_id', user.id)
            .eq('status', 'completed')

          const completedTaggedBooks = books?.filter(book => {
            const bookTags = book.metadata?.tags || []
            return targetTags.some(tag => bookTags.includes(tag))
          }) || []

          progress = Math.min(Math.round((completedTaggedBooks.length / targetTags.length) * 100), 100)
        }

        // Check if mission is completed
        if (progress >= 100) {
          status = 'completed'
          
          // Create activity record for completion
          await supabase
            .from('reading_activities')
            .insert({
              user_id: user.id,
              type: 'mission_completed',
              details: {
                mission_id: mission.id,
                mission_title: mission.title
              },
              timestamp: new Date().toISOString()
            })
        }
      }

      // Update mission
      await supabase
        .from('missions')
        .update({
          progress,
          status,
          updated_at: new Date().toISOString()
        })
        .eq('id', mission.id)
    }

    return new Response(
      JSON.stringify({ success: true }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
}) 