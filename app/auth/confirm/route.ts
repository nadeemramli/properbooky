import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

// Remove edge runtime and use static generation
export const dynamic = 'auto'
export const dynamicParams = true

// Only allow same-origin relative redirects so `next` can't be turned into an
// open redirect (e.g. next=https://evil.com or next=//evil.com).
function safeNext(next: string | null): string {
  if (next && next.startsWith('/') && !next.startsWith('//')) {
    return next
  }
  return '/library'
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const token_hash = requestUrl.searchParams.get('token_hash')
  const type = requestUrl.searchParams.get('type')
  const next = safeNext(requestUrl.searchParams.get('next'))

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