/*
  # Enhanced Authentication Schema

  1. Updates
    - Enhanced user profiles
    - Improved book metadata handling

  2. Security
    - Enhanced RLS policies
    - Better auth integration
    
  3. Performance
    - Optimized indexes
*/

-- Clean up any existing reading statistics related objects
DO $$ 
DECLARE
    _sql text;
BEGIN
    -- Drop specific triggers we know about
    DROP TRIGGER IF EXISTS on_auth_user_created_stats ON auth.users;
    DROP TRIGGER IF EXISTS create_user_reading_statistics ON auth.users;
    DROP TRIGGER IF EXISTS handle_reading_statistics ON auth.users;
    
    -- Drop known functions
    DROP FUNCTION IF EXISTS public.create_user_reading_statistics() CASCADE;
    DROP FUNCTION IF EXISTS public.handle_reading_statistics() CASCADE;
    DROP FUNCTION IF EXISTS public.update_reading_statistics() CASCADE;
    DROP FUNCTION IF EXISTS public.create_reading_statistics() CASCADE;
    
    -- Drop known tables
    DROP TABLE IF EXISTS public.reading_statistics CASCADE;
    DROP TABLE IF EXISTS public.user_reading_stats CASCADE;
    DROP TABLE IF EXISTS public.reading_stats CASCADE;
    DROP TABLE IF EXISTS public.statistics CASCADE;
    DROP TABLE IF EXISTS public.stats CASCADE;
    DROP TABLE IF EXISTS public.user_stats CASCADE;
    DROP TABLE IF EXISTS public.reading_activities CASCADE;
    DROP TABLE IF EXISTS public.reading_sessions CASCADE;
    DROP TABLE IF EXISTS public.user_reading_activities CASCADE;
    DROP TABLE IF EXISTS public.user_reading_sessions CASCADE;
END $$;

-- Drop existing tables if they exist (to avoid conflicts)
DROP TABLE IF EXISTS public.highlights CASCADE;
DROP TABLE IF EXISTS public.books CASCADE;

-- Create books table
CREATE TABLE public.books (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    title text NOT NULL,
    author text,
    format text NOT NULL CHECK (format IN ('pdf', 'epub')),
    file_url text,
    cover_url text,
    status text NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'reading', 'completed')),
    progress integer DEFAULT 0,
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    metadata jsonb DEFAULT '{}'::jsonb,
    priority_score integer DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    last_read timestamptz
);

-- Create highlights table for storing book highlights
CREATE TABLE IF NOT EXISTS public.highlights (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    book_id uuid REFERENCES public.books(id) ON DELETE CASCADE,
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    text text NOT NULL,
    note text,
    page integer,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS books_user_id_idx ON public.books(user_id);
CREATE INDEX IF NOT EXISTS books_status_idx ON public.books(status);
CREATE INDEX IF NOT EXISTS books_priority_score_idx ON public.books(priority_score);
CREATE INDEX IF NOT EXISTS highlights_book_id_idx ON public.highlights(book_id);
CREATE INDEX IF NOT EXISTS highlights_user_id_idx ON public.highlights(user_id);

-- Enable RLS on all tables
ALTER TABLE public.books ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.highlights ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for books
CREATE POLICY "Users can view own books"
    ON public.books FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create own books"
    ON public.books FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own books"
    ON public.books FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own books"
    ON public.books FOR DELETE
    USING (auth.uid() = user_id);

-- Create RLS policies for highlights
CREATE POLICY "Users can view own highlights"
    ON public.highlights FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create own highlights"
    ON public.highlights FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own highlights"
    ON public.highlights FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own highlights"
    ON public.highlights FOR DELETE
    USING (auth.uid() = user_id);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
DO $$
BEGIN
    -- Books
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'handle_books_updated_at'
    ) THEN
        CREATE TRIGGER handle_books_updated_at
            BEFORE UPDATE ON public.books
            FOR EACH ROW
            EXECUTE FUNCTION handle_updated_at();
    END IF;

    -- Highlights
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'handle_highlights_updated_at'
    ) THEN
        CREATE TRIGGER handle_highlights_updated_at
            BEFORE UPDATE ON public.highlights
            FOR EACH ROW
            EXECUTE FUNCTION handle_updated_at();
    END IF;
END $$; 