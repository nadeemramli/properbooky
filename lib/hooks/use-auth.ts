import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { User, Session, AuthChangeEvent } from '@supabase/supabase-js'

// Mock user for development
const MOCK_USER: User = {
  id: 'dev-user',
  email: 'dev@example.com',
  created_at: new Date().toISOString(),
  app_metadata: {},
  user_metadata: {},
  aud: 'authenticated',
  role: 'authenticated'
}

// Mock session for development
const MOCK_SESSION: Session = {
  access_token: 'mock-token',
  token_type: 'bearer',
  expires_in: 3600,
  refresh_token: 'mock-refresh-token',
  user: MOCK_USER,
  expires_at: Math.floor(Date.now() / 1000) + 3600
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const supabase = createClient()

  const updateAuthState = (session: Session | null) => {
    setSession(session)
    setUser(session?.user ?? null)
    setIsAuthenticated(!!session?.user)
  }

  useEffect(() => {
    // Check for development bypass
    if (process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === 'true') {
      setUser(MOCK_USER)
      setSession(MOCK_SESSION)
      setIsAuthenticated(true)
      setLoading(false)
      return
    }

    let mounted = true

    // Get session from storage
    supabase.auth.getSession().then(({ data: { session } }) => {
      console.log('Auth Session Debug:', {
        hasSession: !!session,
        user: session?.user ? {
          id: session.user.id,
          email: session.user.email,
          role: session.user.role
        } : null
      });
      
      if (mounted) {
        updateAuthState(session)
        setLoading(false)
      }
    })

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      console.log('Auth State Change:', {
        event,
        hasSession: !!session,
        user: session?.user ? {
          id: session.user.id,
          email: session.user.email,
          role: session.user.role
        } : null
      });

      if (mounted) {
        updateAuthState(session)
        setLoading(false)
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  const signIn = async () => {
    // If in development bypass mode, simulate successful sign in
    if (process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === 'true') {
      setUser(MOCK_USER)
      setSession(MOCK_SESSION)
      return
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (error) {
      throw error
    }
  }

  const signOut = async () => {
    // If in development bypass mode, simulate sign out
    if (process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === 'true') {
      setUser(null)
      setSession(null)
      router.push('/auth')
      return
    }

    const { error } = await supabase.auth.signOut()
    if (error) {
      throw error
    }
    router.push('/auth')
  }

  return {
    user,
    session,
    loading,
    signIn,
    signOut,
    isAuthenticated,
  }
} 