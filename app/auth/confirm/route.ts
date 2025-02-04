import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const token_hash = requestUrl.searchParams.get('token_hash')
  const type = requestUrl.searchParams.get('type')
  const next = requestUrl.searchParams.get('next') ?? '/library'

  // If there's no token hash, redirect to home page
  if (!token_hash) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  if (type !== 'email') {
    return NextResponse.redirect(new URL('/', request.url))
  }

  try {
    const supabase = createRouteHandlerClient({ cookies: () => cookies() })
    const { error } = await supabase.auth.verifyOtp({
      type: 'email',
      token_hash,
    })

    if (error) {
      throw error
    }

    return NextResponse.redirect(new URL(next, request.url))
  } catch (error) {
    console.error('Error verifying email:', error)
    return NextResponse.redirect(
      new URL(`/auth?error=Could not verify email`, request.url)
    )
  }
} 