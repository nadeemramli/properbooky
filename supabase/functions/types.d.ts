/// <reference types="@supabase/supabase-js" />

// Deno runtime
declare namespace Deno {
  export interface Env {
    get(key: string): string | undefined;
  }
  export const env: Env;
}

// Deno std library
declare module "https://deno.land/std@0.168.0/http/server.ts" {
  export type Handler = (request: Request) => Response | Promise<Response>;
  export function serve(handler: Handler): void;
}

// Supabase
declare module "https://esm.sh/@supabase/supabase-js@2" {
  export * from "@supabase/supabase-js";
}

// Book types
export interface Book {
  id: string;
  status: 'reading' | 'unread' | 'completed';
  metadata: Record<string, unknown>;
  highlights: Array<{ count: number }>;
  user_id: string;
  priority_score?: number;
}

// Reading session types
export interface ReadingSession {
  id: string;
  user_id: string;
  book_id: string;
  created_at: string;
  pages_read: number;
  minutes_read: number;
}

// Response types
export interface SuccessResponse {
  success: boolean;
  data?: unknown;
}

export interface ErrorResponse {
  error: string;
  details?: unknown;
}

// Utility types
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
}; 