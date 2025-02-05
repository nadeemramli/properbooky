import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { ReadingSession, ErrorResponse } from '../types'
import { isReadingSession } from '../types/guards'

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

    // Get all reading sessions for the user
    const { data: sessionsData, error: sessionsError } = await supabaseClient
      .from('reading_sessions')
      .select('*')
      .eq('user_id', user.id)

    if (sessionsError) throw sessionsError
    if (!sessionsData) throw new Error('No reading sessions found')

    // Filter and validate sessions
    const sessions = sessionsData.filter(isReadingSession)

    // Calculate total reading time
    const totalMinutes = sessions.reduce((sum, session) => {
      const duration = new Date(session.end_time).getTime() - new Date(session.start_time).getTime()
      return sum + (duration / (1000 * 60))
    }, 0)

    // Update user's challenges
    const { error: updateError } = await supabaseClient
      .from('user_challenges')
      .upsert({
        user_id: user.id,
        total_reading_time: totalMinutes,
        last_updated: new Date().toISOString(),
      })

    if (updateError) throw updateError

    return new Response(
      JSON.stringify({
        success: true,
        data: { totalMinutes },
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