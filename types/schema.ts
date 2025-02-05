import type { Database } from "./database";
import type { GenericSchema, GenericTable } from "@supabase/supabase-js";

export type Schema = Database["public"];
export type Tables = Schema["Tables"];
export type TableName = keyof Tables;

export type TableRow<T extends TableName> = Tables[T]["Row"];
export type TableInsert<T extends TableName> = Tables[T]["Insert"];
export type TableUpdate<T extends TableName> = Tables[T]["Update"];

// Add Relationships type to make tables compatible with GenericTable
export type TableWithRelations<T extends TableName> = Tables[T] & {
  Relationships: Tables[T] extends { Relationships: unknown }
    ? Tables[T]["Relationships"]
    : [];
};

// Type-safe schema that satisfies GenericSchema constraint
export interface TypedSchema extends Omit<Schema, "Tables">, GenericSchema {
  Tables: {
    [K in TableName]: TableWithRelations<K> & GenericTable;
  };
} 