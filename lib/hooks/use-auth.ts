import { useEffect, useState } from "react";
import type { User } from "@supabase/auth-helpers-nextjs";
import type { Database } from "@/types/database";
import { setupDefaultBooks } from "@/lib/utils/default-books";
import { isDev, getDevUser } from "@/lib/config/development";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";

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

  // Immediate development mode initialization
  useEffect(() => {
    if (isDev()) {
      const devUser = getDevUser();
      if (devUser) {
        // Create a development session
        const setupDevSession = async () => {
          try {
            const { data, error } = await supabase.auth.signInWithPassword({
              email: devUser.email,
              password: process.env.NEXT_PUBLIC_DEV_PASSWORD || 'development'
            });
            
            if (error) {
              console.error("Failed to create dev session:", error);
              // Fallback to creating user if it doesn't exist
              const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
                email: devUser.email,
                password: process.env.NEXT_PUBLIC_DEV_PASSWORD || 'development'
              });
              
              if (signUpError) {
                console.error("Failed to create dev user:", signUpError);
                return;
              }
            }
            
            setUser(devUser as AuthUser);
            setIsAuthenticated(true);
            setLoading(false);
          } catch (error) {
            console.error("Dev session setup error:", error);
          }
        };
        
        setupDevSession();
      }
    }
  }, [supabase.auth]); // Add supabase.auth as dependency

  // Main auth initialization
  useEffect(() => {
    const initAuth = async () => {
      try {
        // Skip if already initialized in dev mode
        if (isDev()) {
          const devUser = getDevUser();
          if (devUser) {
            try {
              await setupDefaultBooks(devUser.id);
            } catch (error) {
              console.error("Error setting up default books:", error);
            }
            return;
          }
        }

        // Handle production mode
        const { data: { session } } = await supabase.auth.getSession();
        
        if (session?.user) {
          setUser(session.user as AuthUser);
          setIsAuthenticated(true);
          await setupDefaultBooks(session.user.id);
        }
      } catch (error) {
        console.error("Auth error:", error);
        setUser(null);
        setIsAuthenticated(false);
      } finally {
        setLoading(false);
      }
    };

    initAuth();

    // Only set up auth listener in production
    if (!isDev()) {
      const { data: { subscription } } = supabase.auth.onAuthStateChange(
        async (event, session) => {
          if (session?.user) {
            setUser(session.user as AuthUser);
            setIsAuthenticated(true);
          } else {
            setUser(null);
            setIsAuthenticated(false);
          }
        }
      );

      return () => {
        subscription.unsubscribe();
      };
    }

    return () => {}; // Empty cleanup for dev mode
  }, [supabase.auth]);

  // Simplified auth methods for development mode
  const signIn = async (email: string, password: string) => {
    if (isDev()) {
      const devUser = getDevUser();
      setUser(devUser as AuthUser);
      setIsAuthenticated(true);
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
  };

  const signUp = async (email: string, password: string) => {
    if (isDev()) {
      const devUser = getDevUser();
      setUser(devUser as AuthUser);
      setIsAuthenticated(true);
      return;
    }

    const { error } = await supabase.auth.signUp({
      email,
      password,
    });
    if (error) throw error;
  };

  const signOut = async () => {
    if (isDev()) {
      setUser(null);
      setIsAuthenticated(false);
      return;
    }

    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  const signInWithGoogle = async () => {
    if (isDev()) {
      const devUser = getDevUser();
      setUser(devUser as AuthUser);
      setIsAuthenticated(true);
      return;
    }

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