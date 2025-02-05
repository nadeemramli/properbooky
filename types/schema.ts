import type { Database } from "./database";

export type Schema = Database["public"];
export type Tables = Schema["Tables"];
export type TableName = keyof Tables;

export type TableRow<T extends TableName> = Tables[T]["Row"];
export type TableInsert<T extends TableName> = Tables[T]["Insert"];
export type TableUpdate<T extends TableName> = Tables[T]["Update"];

// Simplified version without GenericSchema
export type TableWithRelations<T extends TableName> = Tables[T] & {
  Relationships: Tables[T] extends { Relationships: unknown }
    ? Tables[T]["Relationships"]
    : [];
}; 