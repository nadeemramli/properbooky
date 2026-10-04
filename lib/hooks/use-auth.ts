import { useEffect, useState } from "react";
import type { User } from "@supabase/auth-helpers-nextjs";
import type { Database } from "@/types/database";
import { setupDefaultBooks } from "@/lib/utils/default-books";
import { isDev, DEV_CONFIG } from "@/lib/config/development";
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

type BrowserClient = ReturnType<typeof createClientComponentClient<Database>>;

// Every component calling useAuth shares one dev sign-in per page load, so
// concurrent mounts cannot race each other into duplicate sign-ups.
let devSession: Promise<User | null> | null = null;

function ensureDevSession(supabase: BrowserClient): Promise<User | null> {
  devSession ??= (async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) return session.user;

    const credentials = {
      email: DEV_CONFIG.DEV_USER.email,
      password: process.env.NEXT_PUBLIC_DEV_PASSWORD || "development",
    };
    const signedIn = await supabase.auth.signInWithPassword(credentials);
    if (!signedIn.error) return signedIn.data.user;

    // First run against an empty local stack: create the dev account.
    const signedUp = await supabase.auth.signUp(credentials);
    if (signedUp.error || !signedUp.data.session) {
      console.error(
        "Failed to create dev session:",
        signedUp.error ?? "sign-up needs email confirmation; seed the dev user"
      );
      return null;
    }
    return signedUp.data.user;
  })().then(
    (user) => {
      if (!user) devSession = null; // allow a retry on the next mount
      return user;
    },
    (error) => {
      devSession = null;
      throw error;
    }
  );
  return devSession;
}

export function useAuth(): AuthResponse {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  
  const supabase = createClientComponentClient<Database>();

  // Resolve the signed-in user once per mount. Dev mode signs in the dev
  // account first; either way the identity used for data is the real session
  // user, so row-level security sees the same id the client writes.
  useEffect(() => {
    let active = true;

    const initAuth = async () => {
      try {
        const sessionUser = isDev()
          ? await ensureDevSession(supabase)
          : (await supabase.auth.getSession()).data.session?.user ?? null;
        if (!active) return;

        if (sessionUser) {
          setUser(sessionUser as AuthUser);
          setIsAuthenticated(true);
          await setupDefaultBooks(sessionUser.id, supabase);
        }
      } catch (error) {
        console.error("Auth error:", error);
        if (active) {
          setUser(null);
          setIsAuthenticated(false);
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (!active) return;
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
      active = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  const adoptDevSession = async () => {
    const devUser = await ensureDevSession(supabase);
    setUser(devUser as AuthUser | null);
    setIsAuthenticated(Boolean(devUser));
  };

  // Simplified auth methods for development mode
  const signIn = async (email: string, password: string) => {
    if (isDev()) {
      await adoptDevSession();
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
      await adoptDevSession();
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
      await adoptDevSession();
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