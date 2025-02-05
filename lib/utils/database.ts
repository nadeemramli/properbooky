import { createClient } from "@/lib/supabase/client";
import type { Database, User, UserMetadata } from "@/types/database";
import type { PostgrestError } from "@supabase/supabase-js";
import { createDatabaseError } from "./error";
import { createTypeSafeQuery, type TableTypes } from "./supabase-query";

type Tables = Database['public']['Tables'];
type TableName = keyof Tables;

interface DatabaseResponse<T> {
  data: T | null;
  error: PostgrestError | null;
}

export type DbResult<T> = {
  data: T | null;
  error: PostgrestError | null;
};

export type DbResultOk<T> = {
  data: T;
  error: null;
};

/**
 * Type predicate to narrow a DbResult to a successful result
 */
export function isDbResultOk<T>(result: DbResult<T>): result is DbResultOk<T> {
  return !result.error && result.data !== null;
}

/**
 * Type-safe database operations
 */
export const db = {
  /**
   * Get a single row by id
   */
  async getById<T extends TableName>(
    table: T,
    id: string,
  ): Promise<DbResult<TableTypes<T>['Row']>> {
    const supabase = createClient();
    const result = await supabase
      .from(table)
      .select('*')
      .eq('id' as any, id)
      .maybeSingle();
    
    if (result.error) {
      return { data: null, error: result.error };
    }
    
    return { data: result.data as TableTypes<T>['Row'] | null, error: null };
  },

  /**
   * Update a single row by id
   */
  async updateById<T extends TableName>(
    table: T,
    id: string,
    data: TableTypes<T>['Update'],
  ): Promise<DbResult<TableTypes<T>['Row']>> {
    const supabase = createClient();
    const result = await supabase
      .from(table)
      .update(data as any)
      .eq('id' as any, id)
      .select()
      .maybeSingle();
    
    if (result.error) {
      return { data: null, error: result.error };
    }
    
    return { data: result.data as TableTypes<T>['Row'] | null, error: null };
  },

  /**
   * Get user profile with proper type handling
   */
  async getUserProfile(userId: string): Promise<DbResult<User>> {
    const supabase = createClient();
    const result = await supabase
      .from('users')
      .select()
      .eq('id' as any, userId)
      .maybeSingle();
    
    if (result.error) {
      return { data: null, error: result.error };
    }

    if (!result.data) {
      return { data: null, error: null };
    }

    // Ensure the returned data matches our User type
    const user: User = {
      id: result.data.id,
      email: result.data.email,
      created_at: result.data.created_at,
      updated_at: result.data.updated_at,
      metadata: (result.data as any).metadata || {},
      name: (result.data as any).name || '',
      avatar_url: (result.data as any).avatar_url || '',
      provider: (result.data as any).provider || 'email',
    };
    
    return { data: user, error: null };
  },

  /**
   * Update user profile with proper metadata handling
   */
  async updateUserProfile(
    userId: string,
    data: {
      name?: string;
      avatar_url?: string;
      metadata?: UserMetadata;
    },
  ): Promise<DbResult<User>> {
    const supabase = createClient();
    
    // First get the current profile to merge metadata
    const currentProfile = await this.getUserProfile(userId);
    if (!isDbResultOk(currentProfile)) {
      return currentProfile;
    }

    const result = await supabase
      .from('users')
      .update({
        ...data,
        metadata: {
          ...currentProfile.data.metadata,
          ...data.metadata,
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id' as any, userId)
      .select()
      .maybeSingle();
    
    if (result.error) {
      return { data: null, error: result.error };
    }

    if (!result.data) {
      return { data: null, error: null };
    }

    // Ensure the returned data matches our User type
    const user: User = {
      id: result.data.id,
      email: result.data.email,
      created_at: result.data.created_at,
      updated_at: result.data.updated_at,
      metadata: (result.data as any).metadata || {},
      name: (result.data as any).name || '',
      avatar_url: (result.data as any).avatar_url || '',
      provider: (result.data as any).provider || 'email',
    };
    
    return { data: user, error: null };
  },

  async insertRow<T extends TableName>(
    table: T,
    data: TableTypes<T>['Insert']
  ): Promise<DatabaseResponse<TableTypes<T>['Row']>> {
    try {
      const supabase = createClient();
      const result = await supabase
        .from(table)
        .insert(data as any)
        .select()
        .maybeSingle();

      if (result.error) {
        return { data: null, error: result.error };
      }

      return { data: result.data as TableTypes<T>['Row'] | null, error: null };
    } catch (error) {
      return {
        data: null,
        error: error as PostgrestError,
      };
    }
  },

  async updateRow<T extends TableName>(
    table: T,
    id: string,
    data: TableTypes<T>['Update']
  ): Promise<DatabaseResponse<TableTypes<T>['Row']>> {
    try {
      const supabase = createClient();
      const result = await supabase
        .from(table)
        .update(data as any)
        .eq('id' as any, id)
        .select()
        .maybeSingle();
      
      if (result.error) {
        return { data: null, error: result.error };
      }

      return { data: result.data as TableTypes<T>['Row'] | null, error: null };
    } catch (error) {
      return {
        data: null,
        error: error as PostgrestError,
      };
    }
  },

  async deleteRow<T extends TableName>(
    table: T,
    id: string
  ): Promise<DatabaseResponse<null>> {
    try {
      const supabase = createClient();
      const result = await supabase
        .from(table)
        .delete()
        .eq('id' as any, id);

      if (result.error) {
        return { data: null, error: result.error };
      }

      return { data: null, error: null };
    } catch (error) {
      return {
        data: null,
        error: error as PostgrestError,
      };
    }
  },

  async getRowById<T extends TableName>(
    table: T,
    id: string
  ): Promise<DatabaseResponse<TableTypes<T>['Row']>> {
    try {
      const supabase = createClient();
      const result = await supabase
        .from(table)
        .select()
        .eq('id' as any, id)
        .maybeSingle();

      if (result.error) {
        return { data: null, error: result.error };
      }

      return { data: result.data as TableTypes<T>['Row'] | null, error: null };
    } catch (error) {
      return {
        data: null,
        error: error as PostgrestError,
      };
    }
  },
}; 