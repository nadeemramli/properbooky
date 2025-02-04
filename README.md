# ProperBooky

A modern library management system built with Next.js and Supabase.

## Environment Setup

### Required Environment Variables

```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
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

## Authentication

Authentication is handled through Supabase with the following features:

- OAuth (Google Sign-in)
- Email/Password authentication
- Password reset functionality
- Email verification

Authentication hooks and utilities are located in:
- `lib/hooks/use-auth.ts`
- `app/auth/components/`

### Auth Redirects

We use dynamic redirect URLs based on the environment:

```typescript
// Dynamic redirect URL configuration
redirectTo: `${window.location.origin}/auth/callback`
```

## Static Site Generation & Server-Side Rendering

### Next.js Configuration

```javascript
// next.config.js
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: { unoptimized: true },
  transpilePackages: ['@radix-ui/react-progress'],
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@radix-ui/react-progress': require.resolve('@radix-ui/react-progress'),
    };
    return config;
  },
  env: {
    NEXT_PHASE: process.env["NEXT_PHASE"] || "development",
  },
};
```

### Dynamic Routes

For dynamic routes (e.g., `/library/[id]`), we implement `generateStaticParams` with build-time considerations:

```typescript
export async function generateStaticParams() {
  if (process.env["NEXT_PHASE"] === "build") {
    return [];
  }

  try {
    const supabase = createClient();
    const { data: books } = await supabase.from("books").select("id");
    // ... handle data and return params
  } catch (error) {
    console.error("Error generating static params:", error);
    return [];
  }
}
```

## UI Components

We use a combination of custom components and shadcn/ui components:

### Progress Component
```typescript
// components/ui/progress.tsx
const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & {
    value?: number | null;
  }
>((props) => {
  // Implementation
});
```

### Book Components
- `BookProfileDialog`: Displays detailed book information
- `BookGrid`: Grid view of books
- `BookList`: List view of books

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

## Future Considerations

1. **Performance Optimizations**:
   - Implement proper caching strategies
   - Add service worker for offline support
   - Optimize image loading and processing

2. **Feature Additions**:
   - Reading progress synchronization
   - Book highlights and notes
   - Social sharing features

3. **Security Enhancements**:
   - Implement rate limiting
   - Add CSRF protection
   - Enhanced error logging