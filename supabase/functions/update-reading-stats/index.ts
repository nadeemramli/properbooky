import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

    // Get all reading sessions for the user
    const { data: sessions, error: sessionsError } = await supabase
      .from('reading_sessions')
      .select('*')
      .eq('user_id', user.id)
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())

    if (sessionsError) throw sessionsError

    // Calculate weekly data
    const weeklyData: WeeklyData[] = []
    const now = new Date()
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now)
      date.setDate(date.getDate() - i)
      const dayName = date.toLocaleDateString('en-US', { weekday: 'short' })
      const dayPages = sessions
        .filter(session => new Date(session.created_at).toDateString() === date.toDateString())
        .reduce((sum, session) => sum + (session.pages_read || 0), 0)
      weeklyData.push({ name: dayName, pages: dayPages })
    }

    // Calculate monthly data
    const monthlyData: MonthlyData[] = []
    for (let i = 3; i >= 0; i--) {
      const weekStart = new Date(now)
      weekStart.setDate(weekStart.getDate() - (i * 7 + 6))
      const weekPages = sessions
        .filter(session => {
          const sessionDate = new Date(session.created_at)
          return sessionDate >= weekStart && sessionDate <= new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000)
        })
        .reduce((sum, session) => sum + (session.pages_read || 0), 0)
      monthlyData.push({ name: `Week ${4-i}`, pages: weekPages })
    }

    // Calculate total pages read this week
    const weekStart = new Date(now)
    weekStart.setDate(weekStart.getDate() - 6)
    const pagesThisWeek = sessions
      .filter(session => new Date(session.created_at) >= weekStart)
      .reduce((sum, session) => sum + (session.pages_read || 0), 0)

    // Calculate total reading time this week (in minutes)
    const readingTimeThisWeek = sessions
      .filter(session => new Date(session.created_at) >= weekStart)
      .reduce((sum, session) => {
        if (!session.end_time) return sum
        const duration = new Date(session.end_time).getTime() - new Date(session.start_time).getTime()
        return sum + (duration / (1000 * 60))
      }, 0)

    // Get completed books this week
    const { data: completedBooks, error: completedError } = await supabase
      .from('reading_activities')
      .select('*')
      .eq('user_id', user.id)
      .eq('type', 'finished')
      .gte('timestamp', weekStart.toISOString())

    if (completedError) throw completedError

    // Calculate daily average
    const dailyAverage = Math.round(pagesThisWeek / 7)

    // Calculate weekly change
    const previousWeekStart = new Date(weekStart)
    previousWeekStart.setDate(previousWeekStart.getDate() - 7)
    const previousWeekPages = sessions
      .filter(session => {
        const date = new Date(session.created_at)
        return date >= previousWeekStart && date < weekStart
      })
      .reduce((sum, session) => sum + (session.pages_read || 0), 0)

    const weeklyChange = previousWeekPages === 0 
      ? 100 
      : Math.round(((pagesThisWeek - previousWeekPages) / previousWeekPages) * 100)

    // Update reading statistics
    const { error: updateError } = await supabase
      .from('reading_statistics')
      .upsert({
        user_id: user.id,
        pages_read: pagesThisWeek,
        reading_time: Math.round(readingTimeThisWeek),
        books_completed: completedBooks?.length || 0,
        daily_average: dailyAverage,
        weekly_data: weeklyData,
        monthly_data: monthlyData,
        weekly_change: weeklyChange,
        updated_at: new Date().toISOString(),
      })

    if (updateError) throw updateError

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