# ProperBooky

A modern library management system built with Next.js and Supabase, designed for managing your digital book collection with powerful features for organizing, tracking, and enhancing your reading experience.

## Features

### Book Management
- **File Support**: Upload and manage PDF and EPUB files (up to 100MB)
- **Metadata Extraction**: Automatic extraction of book metadata from PDF and EPUB files
- **Book Status Tracking**: Track books as unread, reading, completed, or wishlist
- **Progress Tracking**: Monitor reading progress and last read dates
- **Smart Prioritization**: Automatic priority scoring based on multiple factors
- **Wishlist Management**: Keep track of books you want to read
- **Book Recommendations**: Get and manage book recommendations

### Reading Features
- **Highlights**: Create and manage highlights with page numbers
- **Reading Sessions**: Track reading sessions with start/end times and pages read
- **Reading Statistics**: View detailed reading statistics and progress
- **Missions**: Set and track reading goals and missions
- **Obsidian Integration**: Export highlights to Obsidian-compatible markdown format

### Technical Features
- **Secure Authentication**: Built-in user authentication and authorization
- **Row Level Security**: Secure data access control at the database level
- **File Compression**: Automatic PDF compression to optimize storage
- **Full-text Search**: Advanced search capabilities across book metadata
- **Real-time Updates**: Live updates for reading progress and statistics

## System Architecture

### Database Schema

#### Books Table
```sql
CREATE TABLE books (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES auth.users,
    title TEXT NOT NULL,
    author TEXT,
    format TEXT CHECK (format IN ('pdf', 'epub')),
    file_url TEXT,
    status TEXT CHECK (status IN ('unread', 'reading', 'completed', 'wishlist')),
    progress INTEGER DEFAULT 0,
    metadata JSONB,
    priority_score INTEGER,
    publication_year INTEGER,
    knowledge_spectrum DECIMAL(3,2),
    manual_rating DECIMAL(3,2),
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    last_read TIMESTAMPTZ
)
```

#### Highlights Table
```sql
CREATE TABLE highlights (
    id UUID PRIMARY KEY,
    book_id UUID REFERENCES books,
    user_id UUID REFERENCES auth.users,
    content TEXT NOT NULL,
    page_number INTEGER,
    created_at TIMESTAMPTZ
)
```

### Type System

#### Book Types
```typescript
export interface Book {
    id: string;
    title: string;
    author?: string;
    format: "pdf" | "epub";
    file_url: string;
    status: BookStatus;
    progress: number;
    metadata: BookMetadata;
    priority_score: number;
    created_at: string;
    updated_at: string;
    last_read: string | null;
}

export interface BookMetadata {
    publisher?: string;
    published_date?: string;
    language?: string;
    pages?: number;
    isbn?: string;
    description?: string;
    wishlist_reason?: string;
    wishlist_priority?: number;
    goodreads_url?: string;
    amazon_url?: string;
}
```

## File Upload System

### Supported Formats
- PDF (application/pdf)
- EPUB (application/epub+zip)

### File Processing
1. **Validation**
   - Size limit: 100MB
   - Format verification
   - File integrity checks
   
2. **Metadata Extraction**
   - PDF: Title, Author, Publisher, Creation Date, Language, Pages
   - EPUB: Title, Creator, Publisher, Publication Date, Language

3. **Storage**
   - Files stored in Supabase Storage
   - Organized by user ID
   - Compressed when possible (PDF)
   - Public URL generation for access

### Upload Process
```typescript
async function uploadBookFile(file: File, userId: string): Promise<BookUpload> {
    1. Validate file (size, format, integrity)
    2. Compress file if PDF
    3. Extract metadata
    4. Generate unique filename
    5. Upload to storage
    6. Return file URL and metadata
}
```

## Environment Setup

### Required Environment Variables
```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your_nextauth_secret
UPSTASH_REDIS_REST_URL=your_redis_url
UPSTASH_REDIS_REST_TOKEN=your_redis_token
```

### Development Setup
1. Clone the repository
2. Install dependencies: `npm install`
3. Set up environment variables
4. Run database migrations: `npx supabase db push`
5. Start development server: `npm run dev`

### Production Deployment
1. Configure Supabase project
2. Set up environment variables in deployment platform
3. Configure authentication redirect URLs
4. Deploy application
5. Run database migrations

## Security

### Authentication
- Supabase Auth integration
- Google OAuth support
- Secure session management

### Authorization
- Row Level Security (RLS) policies
- User-specific data access
- Secure file access controls

### Data Protection
- Encrypted file storage
- Secure metadata handling
- Rate limiting on API endpoints

## API Documentation

### Book Management
- `GET /api/books`: List user's books
- `POST /api/books`: Add new book
- `PUT /api/books/:id`: Update book
- `DELETE /api/books/:id`: Delete book

### File Operations
- `POST /api/upload`: Upload book file
- `DELETE /api/files/:id`: Delete book file

### Reading Progress
- `POST /api/reading-sessions`: Start reading session
- `PUT /api/reading-sessions/:id`: Update session
- `GET /api/statistics`: Get reading statistics

## Contributing

1. Fork the repository
2. Create feature branch
3. Commit changes
4. Push to branch
5. Create Pull Request

## License

MIT License - see LICENSE file for details