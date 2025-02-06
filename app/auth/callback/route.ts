import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url)
    const code = requestUrl.searchParams.get('code')
    const next = requestUrl.searchParams.get('next') ?? '/library'
    const error = requestUrl.searchParams.get('error')
    const error_description = requestUrl.searchParams.get('error_description')

    // Handle error cases
    if (error || error_description) {
      console.error('Auth error:', error, error_description)
      return NextResponse.redirect(
        new URL(`/auth?error=${encodeURIComponent(error_description || error || 'Authentication failed')}`, request.url)
      )
    }

    // If no code is present, redirect to auth page
    if (!code) {
      console.warn('No code present in callback')
      return NextResponse.redirect(new URL('/auth', request.url))
    }

    const cookieStore = cookies()
    const supabase = createRouteHandlerClient({ cookies: () => cookieStore })
    
    // Exchange the code for a session
    const { data: { session }, error: sessionError } = await supabase.auth.exchangeCodeForSession(code)
    
    if (sessionError) {
      console.error('Session error:', sessionError)
      return NextResponse.redirect(
        new URL(`/auth?error=${encodeURIComponent(sessionError.message)}`, request.url)
      )
    }

    if (!session?.user) {
      console.error('No session or user after code exchange')
      return NextResponse.redirect(
        new URL('/auth?error=Failed to create session', request.url)
      )
    }

    // Check if user profile exists
    const { data: existingUser, error: userError } = await supabase
      .from('users')
      .select()
      .eq('id', session.user.id)
      .single()

    if (userError && userError.code !== 'PGRST116') { // PGRST116 is "no rows returned" error
      console.error('Error checking user profile:', userError)
      return NextResponse.redirect(
        new URL('/auth?error=Failed to verify user profile', request.url)
      )
    }

    if (!existingUser) {
      // Create new user profile
      const { error: createError } = await supabase
        .from('users')
        .insert({
          id: session.user.id,
          email: session.user.email,
          name: session.user.user_metadata.full_name || session.user.email?.split('@')[0] || '',
          avatar_url: session.user.user_metadata.avatar_url || '',
          provider: session.user.app_metadata.provider || 'email',
          metadata: {
            preferences: {
              theme: 'system',
              notifications: true
            }
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })

      if (createError) {
        console.error('Error creating user profile:', createError)
        return NextResponse.redirect(
          new URL('/auth?error=Failed to create user profile', request.url)
        )
      }
    }

    // Successful authentication, redirect to the next page
    return NextResponse.redirect(new URL(next, request.url))
  } catch (error) {
    console.error('Unexpected error in callback:', error)
    return NextResponse.redirect(
      new URL('/auth?error=An unexpected error occurred', request.url)
    )
  }
} 