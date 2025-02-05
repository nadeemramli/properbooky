import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import type { DatabaseWithRelations } from "@/types/database";

export type TypedSupabaseClient = ReturnType<typeof createClientComponentClient<DatabaseWithRelations>>;

export function createClient() {
  return createClientComponentClient<DatabaseWithRelations>();
}

/**
 * Type-safe helper to handle Supabase errors
 * @param error Supabase error object
 * @returns Formatted error message
 */
export const handleSupabaseError = (error: unknown): string => {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String(error.message);
  }
  return 'An unknown error occurred';
};