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

    // Get all active challenges
    const { data: challenges, error: challengesError } = await supabase
      .from('challenges')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'active')

    if (challengesError) throw challengesError

    const now = new Date()

    // Process each challenge
    for (const challenge of challenges) {
      let progress = 0
      let status = challenge.status

      // Calculate days left
      const endDate = challenge.end_date ? new Date(challenge.end_date) : null
      const daysLeft = endDate ? Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null

      // Update status if challenge has expired
      if (daysLeft !== null && daysLeft < 0) {
        status = challenge.progress >= challenge.total ? 'completed' : 'failed'
      } else {
        // Calculate progress based on challenge type
        switch (challenge.type) {
          case 'daily': {
            // Check reading sessions for today
            const today = new Date()
            today.setHours(0, 0, 0, 0)
            const { data: sessions } = await supabase
              .from('reading_sessions')
              .select('reading_time')
              .eq('user_id', user.id)
              .gte('created_at', today.toISOString())

            const totalMinutes = sessions?.reduce((sum, session) => {
              const duration = session.end_time 
                ? (new Date(session.end_time).getTime() - new Date(session.start_time).getTime()) / (1000 * 60)
                : 0
              return sum + duration
            }, 0) || 0

            progress = Math.min(Math.round((totalMinutes / challenge.total) * 100), 100)
            break
          }
          case 'weekly': {
            // Check books read this week
            const weekStart = new Date(now)
            weekStart.setDate(weekStart.getDate() - weekStart.getDay())
            weekStart.setHours(0, 0, 0, 0)

            const { data: completed } = await supabase
              .from('reading_activities')
              .select('*')
              .eq('user_id', user.id)
              .eq('type', 'finished')
              .gte('timestamp', weekStart.toISOString())

            progress = Math.min(Math.round(((completed?.length || 0) / challenge.total) * 100), 100)
            break
          }
          case 'monthly': {
            // Check books read this month
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
            
            const { data: completed } = await supabase
              .from('reading_activities')
              .select('*')
              .eq('user_id', user.id)
              .eq('type', 'finished')
              .gte('timestamp', monthStart.toISOString())

            progress = Math.min(Math.round(((completed?.length || 0) / challenge.total) * 100), 100)
            break
          }
        }

        // Check if challenge is completed
        if (progress >= 100) {
          status = 'completed'
          
          // Create activity record for completion
          await supabase
            .from('reading_activities')
            .insert({
              user_id: user.id,
              type: 'challenge_completed',
              details: {
                challenge_id: challenge.id,
                challenge_title: challenge.title,
                type: challenge.type
              },
              timestamp: new Date().toISOString()
            })
        }
      }

      // Update challenge
      await supabase
        .from('challenges')
        .update({
          progress,
          status,
          days_left: daysLeft,
          updated_at: new Date().toISOString()
        })
        .eq('id', challenge.id)
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