import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { ReadingSession, ErrorResponse } from '../types'
import { isReadingSession } from '../types/guards'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface WeeklyData {
  name: string
  pages: number
}

interface MonthlyData {
  name: string
  pages: number
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

    // Calculate reading stats
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const weekStart = new Date(today)
    weekStart.setDate(weekStart.getDate() - weekStart.getDay())

    const todayStats = {
      pages: sessions
        .filter((session) => new Date(session.created_at).toDateString() === today.toDateString())
        .reduce((sum, session) => sum + session.pages_read, 0),
      minutes: sessions
        .filter((session) => new Date(session.created_at).toDateString() === today.toDateString())
        .reduce((sum, session) => sum + session.minutes_read, 0),
    }

    const weekStats = {
      pages: sessions
        .filter((session) => new Date(session.created_at) >= weekStart)
        .reduce((sum, session) => sum + session.pages_read, 0),
      minutes: sessions
        .filter((session) => new Date(session.created_at) >= weekStart)
        .reduce((sum, session) => sum + session.minutes_read, 0),
    }

    // Update user's reading stats
    const { error: updateError } = await supabaseClient
      .from('user_reading_stats')
      .upsert({
        user_id: user.id,
        today_pages: todayStats.pages,
        today_minutes: todayStats.minutes,
        week_pages: weekStats.pages,
        week_minutes: weekStats.minutes,
        last_updated: new Date().toISOString(),
      })

    if (updateError) throw updateError

    return new Response(
      JSON.stringify({
        success: true,
        data: { todayStats, weekStats },
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