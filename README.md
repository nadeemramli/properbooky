# ProperBooky

A modern library management system built with Next.js and Supabase.

## Environment Setup

### Required Environment Variables

```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Google OAuth
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret

# NextAuth.js
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your_nextauth_secret

# Upstash Redis (Rate Limiting)
UPSTASH_REDIS_REST_URL=your_redis_url
UPSTASH_REDIS_REST_TOKEN=your_redis_token
```

### Vercel Deployment Configuration

1. Add the above environment variables to your Vercel project settings
2. Configure Supabase Authentication redirect URLs:
   - `http://localhost:3000/auth/callback` (development)
   - `https://your-vercel-domain.vercel.app/auth/callback` (production)
   - `https://your-custom-domain.com/auth/callback` (if using custom domain)

## Type System

### Database Types

We use a strongly-typed schema for Supabase database interactions:

```typescript
// types/supabase.ts
import type { Database } from '@/lib/database.types';

// Re-export types from generated database types
export type Database = DatabaseGenerated;
export type Tables = Database['public']['Tables'];
export type Enums = Database['public']['Enums'];

// Common table types
export type Book = Tables['books']['Row'];

// Helper types for table operations
export type TableRow<T extends keyof Tables> = Tables[T]['Row'];
export type TableInsert<T extends keyof Tables> = Tables[T]['Insert'];
export type TableUpdate<T extends keyof Tables> = Tables[T]['Update'];
```

### Book Types

```typescript
// types/book.ts
export interface Highlight {
  id: string;
  content: string;
  page: number;
  created_at: string;
  tags?: string[];
}

export interface BookMetadata {
  publisher?: string;
  published_date?: string;
  language?: string;
  pages?: number;
  isbn?: string;
  description?: string;
  [key: string]: any;
}

export interface Book {
  id: string;
  title: string;
  author: string | null;
  cover_url: string | null;
  file_url: string;
  format: 'epub' | 'pdf';
  status: 'unread' | 'reading' | 'completed';
  progress: number | null;
  created_at: string;
  updated_at: string;
  last_read: string | null;
  user_id: string;
  metadata: BookMetadata | null;
  highlights?: Highlight[];
}
```

## Edge Functions

The application uses Supabase Edge Functions for serverless computation. These functions are located in the `supabase/functions` directory.

### Available Edge Functions

1. **calculate-priority**
   - Calculates and updates book priority scores based on reading status and engagement
   - Uses book metadata and highlights for scoring

2. **obsidian-sync**
   - Exports book highlights to Obsidian-compatible markdown format
   - Includes book titles and highlight notes

3. **update-challenges**
   - Tracks and updates user reading challenges
   - Calculates total reading time and progress

4. **update-missions**
   - Manages user reading missions and goals
   - Tracks completed and in-progress books

5. **update-reading-stats**
   - Maintains user reading statistics
   - Tracks daily and weekly reading progress

### Edge Function Types

```typescript
// Common response types
interface SuccessResponse {
  success: boolean;
  data?: unknown;
}

interface ErrorResponse {
  error: string;
  details?: unknown;
}

// Book types for Edge Functions
interface DatabaseBook {
  id: string;
  title: string;
  status: 'reading' | 'unread' | 'completed';
  metadata: Record<string, unknown>;
  user_id: string;
  priority_score?: number;
}

interface Book extends DatabaseBook {
  highlights: Array<DatabaseHighlight>;
}
```

### Development Guidelines for Edge Functions

1. **Type Safety**
   - Use strict TypeScript checking
   - Define proper interfaces for data structures
   - Implement type guards for runtime checks

2. **Error Handling**
   - Use consistent error response format
   - Include detailed error messages
   - Handle all potential error cases

3. **CORS Headers**
   - Include proper CORS headers for all responses
   - Handle OPTIONS requests appropriately

4. **Environment Variables**
   - Access using Deno.env.get
   - Always provide fallback values
   - Keep sensitive information secure

## Authentication

Authentication is handled through Supabase with the following features:

- OAuth (Google Sign-in)
- Email/Password authentication
- Password reset functionality
- Email verification
- Rate limiting for auth endpoints

Authentication hooks and utilities are located in:
- `lib/hooks/use-auth.ts`
- `app/auth/components/`

### Auth Redirects

We use dynamic redirect URLs based on the environment:

```typescript
// Dynamic redirect URL configuration
redirectTo: `${window.location.origin}/auth/callback`
```

## Development Guidelines

1. **TypeScript Strictness**:
   - Use strict type checking
   - Avoid using `any`
   - Use proper type imports: `import type { Type } from 'module'`

2. **Environment Variables**:
   - Access using bracket notation: `process.env["VARIABLE_NAME"]`
   - Always provide fallbacks: `process.env["VARIABLE_NAME"] ?? "default"`

3. **Database Operations**:
   - Use typed Supabase clients
   - Handle errors appropriately
   - Transform data to match frontend types when needed

4. **Component Props**:
   - Define explicit interfaces for props
   - Use proper HTML element props inheritance
   - Implement proper ref forwarding when needed

## Known Configurations

1. **ESLint**:
   - Strict TypeScript checks enabled
   - Import sorting rules
   - No explicit `any` allowed

2. **TypeScript**:
   - Strict mode enabled
   - Path aliases configured
   - Module resolution set to "bundler"

3. **Supabase**:
   - Server-side client for SSR
   - Client-side hooks for real-time updates
   - Type-safe database operations
   - Edge Functions for serverless computation

## Future Considerations

1. **Performance Optimizations**:
   - Implement proper caching strategies
   - Add service worker for offline support
   - Optimize image loading and processing

2. **Feature Additions**:
   - Enhanced reading progress synchronization
   - Advanced book highlights and notes
   - Social sharing features
   - Reading statistics and analytics

3. **Security Enhancements**:
   - Enhanced rate limiting strategies
   - Add CSRF protection
   - Enhanced error logging and monitoring
   - Security headers and best practices