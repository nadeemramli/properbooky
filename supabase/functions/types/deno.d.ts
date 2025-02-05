// Deno runtime types
declare namespace Deno {
  export interface Env {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    delete(key: string): void;
    toObject(): { [key: string]: string };
  }
  export const env: Env;
}

// Deno HTTP server types
declare module "https://deno.land/std@0.168.0/http/server.ts" {
  export interface ServeInit {
    port?: number;
    hostname?: string;
    handler?: Handler;
    onError?: (error: unknown) => Response | Promise<Response>;
  }

  export type Handler = (request: Request) => Response | Promise<Response>;
  
  export function serve(handler: Handler, init?: ServeInit): void;
}

// Global types for Edge Functions
declare global {
  type DenoRequest = Request;
  type DenoResponse = Response;
  
  interface RequestInit {
    method?: string;
    headers?: HeadersInit;
    body?: BodyInit;
    mode?: RequestMode;
    credentials?: RequestCredentials;
    cache?: RequestCache;
    redirect?: RequestRedirect;
    referrer?: string;
    referrerPolicy?: ReferrerPolicy;
    integrity?: string;
    keepalive?: boolean;
    signal?: AbortSignal | null;
  }
} 