import type { DatabaseWithRelations } from "@/types/database";
import type { TypedSupabaseClient } from "@/lib/supabase/client";
import type { PostgrestFilterBuilder } from "@supabase/postgrest-js";
import type { SupabaseClient } from "@supabase/supabase-js";

type Tables = DatabaseWithRelations["public"]["Tables"];
type TableName = keyof Tables;
type Row<T extends TableName> = Tables[T]["Row"];
type Insert<T extends TableName> = Tables[T]["Insert"];
type Update<T extends TableName> = Tables[T]["Update"];

type FilterBuilder<T extends TableName> = PostgrestFilterBuilder<
  DatabaseWithRelations["public"],
  Row<T>,
  Row<T>[]
>;

/**
 * Helper type for table operations
 */
export type TableTypes<T extends TableName> = {
  Row: Row<T>;
  Insert: Insert<T>;
  Update: Update<T>;
};

/**
 * Type-safe database query builder
 * This ensures that column names and types are correct at compile time
 */
export function createTypeSafeQuery<T extends TableName>(
  supabase: SupabaseClient<DatabaseWithRelations>,
  table: T
) {
  return supabase.from(table) as unknown as FilterBuilder<T>;
} 