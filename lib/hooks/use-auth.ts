import { useEffect, useState } from "react";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import type { User } from "@supabase/auth-helpers-nextjs";
import type { Database } from "@/types/database";
import { setupDefaultBooks, ensureDevUserHasBooks } from "@/lib/utils/default-books";

interface AuthUser extends User {
  role?: string;
}

interface AuthResponse {
  user: AuthUser | null;
  isAuthenticated: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

export function useAuth(): AuthResponse {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const supabase = createClientComponentClient<Database>();

  useEffect(() => {
    const initAuth = async () => {
      try {
        // Get session
        const { data: { session } } = await supabase.auth.getSession();
        
        if (process.env.NODE_ENV === "development") {
          // In development, use bypass user if configured
          const devUserId = process.env.NEXT_PUBLIC_DEV_USER_ID;
          if (devUserId) {
            setUser({ id: devUserId, role: "user" } as AuthUser);
            setIsAuthenticated(true);
            // Ensure dev user has default books
            await ensureDevUserHasBooks();
            setLoading(false);
            return;
          }
        }

        if (session?.user) {
          setUser(session.user as AuthUser);
          setIsAuthenticated(true);
          // Set up default books for new users
          await setupDefaultBooks(session.user.id);
        } else {
          setUser(null);
          setIsAuthenticated(false);
        }
      } catch (error) {
        console.error("Auth error:", error);
        setUser(null);
        setIsAuthenticated(false);
      } finally {
        setLoading(false);
      }
    };

    // Initialize auth
    initAuth();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (session?.user) {
          setUser(session.user as AuthUser);
          setIsAuthenticated(true);
          // Set up default books for new users on sign up
          if (event === "SIGNED_IN") {
            await setupDefaultBooks(session.user.id);
          }
        } else {
          setUser(null);
          setIsAuthenticated(false);
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [supabase.auth]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
  };

  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
    });
    if (error) throw error;
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) throw error;
  };

  return {
    user,
    isAuthenticated,
    loading,
    signIn,
    signInWithGoogle,
    signUp,
    signOut,
  };
} 