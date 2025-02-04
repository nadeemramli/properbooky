import type { Database as DatabaseGenerated } from '@/lib/database.types';
import type { 
  User,
  Session,
  AuthChangeEvent,
  SupabaseClient,
  PostgrestResponse,
} from '@supabase/supabase-js';

// Re-export types from generated database types
export type Database = DatabaseGenerated;
export type Tables = Database['public']['Tables'];
export type Enums = Database['public']['Enums'];

// Common table types
export type Book = Tables['books']['Row'];

// Auth types
export type { User, Session, AuthChangeEvent };

// Client types
export type SupabaseClientType = SupabaseClient<Database>;
export type DbResult<T> = PostgrestResponse<T>;

// Helper type for table rows
export type TableRow<T extends keyof Tables> = Tables[T]['Row'];
export type TableInsert<T extends keyof Tables> = Tables[T]['Insert'];
export type TableUpdate<T extends keyof Tables> = Tables[T]['Update']; 