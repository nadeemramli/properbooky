import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

// Remove edge runtime and use static generation
export const dynamic = 'auto'
export const dynamicParams = true

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const next = requestUrl.searchParams.get('next')

  if (code) {
    const cookieStore = cookies()
    const supabase = createRouteHandlerClient({ cookies: () => cookieStore })
    
    // Exchange the code for a session
    const { data: { session }, error: sessionError } = await supabase.auth.exchangeCodeForSession(code)
    
    if (sessionError) {
      console.error('Session error:', sessionError)
      return NextResponse.redirect(new URL('/auth/error', request.url))
    }

    if (session?.user) {
      // Check if user profile exists
      const { data: existingUser } = await supabase
        .from('users')
        .select()
        .eq('id', session.user.id)
        .single()

      if (!existingUser) {
        // Create new user profile
        const { error: createError } = await supabase
          .from('users')
          .insert({
            id: session.user.id,
            email: session.user.email,
            name: session.user.user_metadata.full_name || session.user.email?.split('@')[0] || '',
            avatar_url: session.user.user_metadata.avatar_url || '',
            provider: 'google',
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
          return NextResponse.redirect(new URL('/auth/error', request.url))
        }
      }
    }
  }

  // URL to redirect to after sign in process completes
  return NextResponse.redirect(new URL(next ?? '/library', request.url))
} 