// Supabase client types
declare module "https://esm.sh/@supabase/supabase-js@2" {
  import type { SupabaseClient, User, Session } from "@supabase/supabase-js";
  
  export type { SupabaseClient, User, Session };
  
  export interface SupabaseClientOptions {
    auth?: {
      autoRefreshToken?: boolean;
      persistSession?: boolean;
      detectSessionInUrl?: boolean;
    };
    global?: {
      headers?: Record<string, string>;
    };
  }

  export function createClient(
    supabaseUrl: string,
    supabaseKey: string,
    options?: SupabaseClientOptions
  ): SupabaseClient;
} 