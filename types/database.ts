import type { Database as DatabaseGenerated } from "@/lib/database.types";

// Re-export types from generated database types
export type Database = DatabaseGenerated;

// Add Relationships to make tables compatible with GenericTable
export type DatabaseWithRelations = {
  public: {
    Tables: {
      [K in keyof Database['public']['Tables']]: Database['public']['Tables'][K] & {
        Relationships: [];
      };
    };
    Views: Database['public']['Views'];
    Functions: Database['public']['Functions'];
    Enums: Database['public']['Enums'];
  };
};

export type Tables = DatabaseWithRelations['public']['Tables'];
export type Enums = DatabaseWithRelations['public']['Enums'];

// JSON type from Supabase
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// User metadata type
export interface UserMetadata {
  bio?: string;
  preferences?: {
    theme?: "light" | "dark" | "system";
    notifications?: boolean;
  };
  [key: string]: unknown;
}

// Base user type from the database
export interface BaseUser {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  provider: string;
  metadata: UserMetadata | null;
  created_at: string | null;
  updated_at: string | null;
}

// Extended user type with metadata
export interface User extends BaseUser {
  metadata: UserMetadata;
  name: string;
  avatar_url: string;
}

// Helper types for table operations
export type TableRow<T extends keyof Tables> = Tables[T]["Row"];
export type TableInsert<T extends keyof Tables> = Tables[T]["Insert"];
export type TableUpdate<T extends keyof Tables> = Tables[T]["Update"];

// Type-safe update types
export type UserUpdate = Partial<User> & {
  metadata?: UserMetadata;
};

// Ensure relationships are properly typed
export type TableWithRelations<T extends keyof Tables> = Tables[T] & {
  Relationships: unknown[];
}; 