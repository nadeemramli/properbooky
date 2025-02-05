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
    const query = createTypeSafeQuery(supabase, table);
    const result = await query
      .select()
      .eq('id', id)
      .maybeSingle();
    
    if (result.error) {
      return { data: null, error: result.error };
    }
    
    return { data: result.data, error: null };
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
    const query = createTypeSafeQuery(supabase, table);
    const result = await query
      .update(data)
      .eq('id', id)
      .select()
      .maybeSingle();
    
    if (result.error) {
      return { data: null, error: result.error };
    }
    
    return { data: result.data, error: null };
  },

  /**
   * Get user profile with proper type handling
   */
  async getUserProfile(userId: string): Promise<DbResult<User>> {
    const supabase = createClient();
    const query = createTypeSafeQuery(supabase, 'users');
    const result = await query
      .select()
      .eq('id', userId)
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
      metadata: result.data.metadata || {},
      name: result.data.name || '',
      avatar_url: result.data.avatar_url || '',
      provider: result.data.provider || 'email',
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

    const query = createTypeSafeQuery(supabase, 'users');
    const updateData = {
      ...data,
      metadata: {
        ...currentProfile.data.metadata,
        ...data.metadata,
      },
      updated_at: new Date().toISOString(),
    };

    const result = await query
      .update(updateData)
      .eq('id', userId)
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
      metadata: result.data.metadata || {},
      name: result.data.name || '',
      avatar_url: result.data.avatar_url || '',
      provider: result.data.provider || 'email',
    };
    
    return { data: user, error: null };
  },

  async insertRow<T extends TableName>(
    table: T,
    data: TableTypes<T>['Insert']
  ): Promise<DatabaseResponse<TableTypes<T>['Row']>> {
    try {
      const supabase = createClient();
      const query = createTypeSafeQuery(supabase, table);
      const result = await query
        .insert(data)
        .select()
        .maybeSingle();

      if (result.error) {
        return { data: null, error: result.error };
      }

      return { data: result.data, error: null };
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
      const query = createTypeSafeQuery(supabase, table);
      const result = await query
        .update(data)
        .eq('id', id)
        .select()
        .maybeSingle();
      
      if (result.error) {
        return { data: null, error: result.error };
      }

      return { data: result.data, error: null };
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
      const query = createTypeSafeQuery(supabase, table);
      const result = await query
        .delete()
        .eq('id', id);

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
      const query = createTypeSafeQuery(supabase, table);
      const result = await query
        .select()
        .eq('id', id)
        .maybeSingle();

      if (result.error) {
        return { data: null, error: result.error };
      }

      return { data: result.data, error: null };
    } catch (error) {
      return {
        data: null,
        error: error as PostgrestError,
      };
    }
  },
}; 