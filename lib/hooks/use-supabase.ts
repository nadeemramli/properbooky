import { useState, useCallback } from 'react';
import { createClient, handleSupabaseError } from '@/lib/supabase/client';
import type { PostgrestError } from '@supabase/supabase-js';
import type { DatabaseWithRelations } from '@/types/database';
import { createTypeSafeQuery, type TableTypes } from '@/lib/utils/supabase-query';

type Tables = DatabaseWithRelations['public']['Tables'];
type TableName = keyof Tables;

interface SupabaseResponse<T> {
  data: T | null;
  error: string | null;
  isLoading: boolean;
}

type FilterOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'ilike';

type QueryFilter<T extends TableName> = {
  column: keyof TableTypes<T>['Row'];
  operator: FilterOperator;
  value: any;
};

/**
 * Type-safe database operations
 */
export function useSupabase<T extends TableName>() {
  const [isLoading, setIsLoading] = useState(false);
  const supabase = createClient();
  const query = createTypeSafeQuery(supabase, 'books');

  const handleError = useCallback((error: PostgrestError | null): string | null => {
    if (!error) return null;
    console.error('Supabase error:', error);
    return handleSupabaseError(error);
  }, []);

  const insert = useCallback(async (
    table: T,
    data: TableTypes<T>['Insert']
  ): Promise<SupabaseResponse<TableTypes<T>['Row']>> => {
    setIsLoading(true);
    try {
      const { data: result, error } = await supabase
        .from(table)
        .insert(data as any)
        .select()
        .single();

      return {
        data: result as TableTypes<T>['Row'] | null,
        error: handleError(error),
        isLoading: false,
      };
    } catch (error) {
      return {
        data: null,
        error: handleSupabaseError(error),
        isLoading: false,
      };
    } finally {
      setIsLoading(false);
    }
  }, [supabase, handleError]);

  const update = useCallback(async (
    table: T,
    id: string,
    data: TableTypes<T>['Update']
  ): Promise<SupabaseResponse<TableTypes<T>['Row']>> => {
    setIsLoading(true);
    try {
      const query = createTypeSafeQuery(supabase, table);
      const { data: result, error } = await supabase
        .from(table)
        .update(data as any)
        .eq('id' as any, id)
        .select()
        .single();

      return {
        data: result as TableTypes<T>['Row'] | null,
        error: handleError(error),
        isLoading: false,
      };
    } catch (error) {
      return {
        data: null,
        error: handleSupabaseError(error),
        isLoading: false,
      };
    } finally {
      setIsLoading(false);
    }
  }, [supabase, handleError]);

  const remove = useCallback(async (
    table: T,
    id: string
  ): Promise<SupabaseResponse<null>> => {
    setIsLoading(true);
    try {
      const query = createTypeSafeQuery(supabase, table);
      const { error } = await supabase
        .from(table)
        .delete()
        .eq('id' as any, id);

      return {
        data: null,
        error: handleError(error),
        isLoading: false,
      };
    } catch (error) {
      return {
        data: null,
        error: handleSupabaseError(error),
        isLoading: false,
      };
    } finally {
      setIsLoading(false);
    }
  }, [supabase, handleError]);

  const select = useCallback(async (
    table: T,
    query?: {
      columns?: string;
      filters?: QueryFilter<T>[];
      limit?: number;
      order?: { column: keyof TableTypes<T>['Row']; ascending?: boolean };
    }
  ): Promise<SupabaseResponse<TableTypes<T>['Row'][]>> => {
    setIsLoading(true);
    try {
      let queryBuilder = supabase
        .from(table)
        .select(query?.columns || '*');

      if (query?.filters) {
        for (const filter of query.filters) {
          const { column, operator, value } = filter;
          const columnName = String(column);

          switch (operator) {
            case 'eq':
              queryBuilder = queryBuilder.eq(columnName, value);
              break;
            case 'neq':
              queryBuilder = queryBuilder.neq(columnName, value);
              break;
            case 'gt':
              queryBuilder = queryBuilder.gt(columnName, value);
              break;
            case 'gte':
              queryBuilder = queryBuilder.gte(columnName, value);
              break;
            case 'lt':
              queryBuilder = queryBuilder.lt(columnName, value);
              break;
            case 'lte':
              queryBuilder = queryBuilder.lte(columnName, value);
              break;
            case 'like':
              queryBuilder = queryBuilder.like(columnName, String(value));
              break;
            case 'ilike':
              queryBuilder = queryBuilder.ilike(columnName, String(value));
              break;
          }
        }
      }

      if (query?.order) {
        queryBuilder = queryBuilder.order(
          String(query.order.column),
          { ascending: query.order.ascending ?? true }
        );
      }

      if (query?.limit) {
        queryBuilder = queryBuilder.limit(query.limit);
      }

      const { data: result, error } = await queryBuilder;

      return {
        data: (result as unknown as TableTypes<T>['Row'][]) || [],
        error: handleError(error),
        isLoading: false,
      };
    } catch (error) {
      return {
        data: null,
        error: handleSupabaseError(error),
        isLoading: false,
      };
    } finally {
      setIsLoading(false);
    }
  }, [supabase, handleError]);

  return {
    isLoading,
    insert,
    update,
    remove,
    select,
  };
} 