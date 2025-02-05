/*
  # Database Schema Refinements

  1. Improvements
    - Full-text search capabilities
    - Enhanced metadata handling
    - Better storage organization
    - Improved tag system

  2. Security
    - Storage bucket policies
    - Enhanced RLS
*/

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Drop existing types if they exist
DROP TYPE IF EXISTS book_status CASCADE;
DROP TYPE IF EXISTS highlight_color CASCADE;

-- Enhance books table with search capabilities
DO $$ 
BEGIN
    -- Add search vector if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'books' 
        AND column_name = 'search_vector'
    ) THEN
        ALTER TABLE books 
        ADD COLUMN search_vector tsvector 
        GENERATED ALWAYS AS (
            setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
            setweight(to_tsvector('english', coalesce(metadata->>'author', '')), 'B') ||
            setweight(to_tsvector('english', coalesce(metadata->>'description', '')), 'C')
        ) STORED;
    END IF;

    -- Update format constraints
    ALTER TABLE books 
        DROP CONSTRAINT IF EXISTS books_format_check,
        ADD CONSTRAINT books_format_check CHECK (format IN ('epub', 'pdf'));

    -- Update status constraints
    ALTER TABLE books 
        DROP CONSTRAINT IF EXISTS books_status_check,
        ADD CONSTRAINT books_status_check CHECK (status IN ('unread', 'reading', 'completed'));
END $$;

-- Enhance highlights table
DO $$ 
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'highlights') THEN
        -- Drop old columns
        ALTER TABLE highlights
            DROP COLUMN IF EXISTS color;

        -- Add new columns if they don't exist
        IF NOT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_name = 'highlights' 
            AND column_name = 'tags'
        ) THEN
            ALTER TABLE highlights
                ADD COLUMN tags jsonb DEFAULT '[]';
        END IF;

        -- Add search vector if it doesn't exist
        IF NOT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_name = 'highlights' 
            AND column_name = 'search_vector'
        ) THEN
            ALTER TABLE highlights
                ADD COLUMN search_vector tsvector 
                GENERATED ALWAYS AS (to_tsvector('english', text)) STORED;
        END IF;
    END IF;
END $$;

-- Drop legacy tables
DROP TABLE IF EXISTS highlight_tags CASCADE;

-- Update tags table structure
DO $$ 
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'tags') THEN
        -- Remove old foreign key if it exists
        ALTER TABLE tags
            DROP CONSTRAINT IF EXISTS tags_parent_tag_id_fkey;

        -- Update columns
        IF NOT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_name = 'tags' 
            AND column_name = 'parent_id'
        ) THEN
            ALTER TABLE tags
                DROP COLUMN IF EXISTS parent_tag_id,
                ADD COLUMN parent_id uuid REFERENCES public.tags(id);
        END IF;

        -- Update constraints
        ALTER TABLE tags
            DROP CONSTRAINT IF EXISTS tags_name_user_id_key,
            ADD CONSTRAINT tags_name_user_id_parent_id_key UNIQUE (name, user_id, parent_id);
    END IF;
END $$;

-- Create or update indexes
DO $$ 
BEGIN
    -- Books indexes
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'books_search_idx') THEN
        CREATE INDEX books_search_idx ON public.books USING gin(search_vector);
    END IF;

    -- Highlights indexes
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'highlights_search_idx') THEN
        CREATE INDEX highlights_search_idx ON public.highlights USING gin(search_vector);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'highlights_tags_idx') THEN
        CREATE INDEX highlights_tags_idx ON public.highlights USING gin(tags);
    END IF;

    -- Tags indexes
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'tags_parent_id_idx') THEN
        CREATE INDEX tags_parent_id_idx ON public.tags(parent_id);
    END IF;
END $$;

-- Create storage buckets if they don't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT FROM storage.buckets WHERE id = 'epubs') THEN
        INSERT INTO storage.buckets (id, name, public) VALUES ('epubs', 'epubs', false);
    END IF;
    IF NOT EXISTS (SELECT FROM storage.buckets WHERE id = 'pdfs') THEN
        INSERT INTO storage.buckets (id, name, public) VALUES ('pdfs', 'pdfs', false);
    END IF;
END $$;

-- Create storage policies
DO $$ 
BEGIN
    -- Epubs policies
    IF NOT EXISTS (
        SELECT FROM pg_policies 
        WHERE tablename = 'objects' 
        AND policyname = 'Users can manage own epubs'
    ) THEN
        CREATE POLICY "Users can manage own epubs"
            ON storage.objects
            FOR ALL
            TO authenticated
            USING (bucket_id = 'epubs' AND auth.uid()::text = (storage.foldername(name))[1])
            WITH CHECK (bucket_id = 'epubs' AND auth.uid()::text = (storage.foldername(name))[1]);
    END IF;

    -- PDFs policies
    IF NOT EXISTS (
        SELECT FROM pg_policies 
        WHERE tablename = 'objects' 
        AND policyname = 'Users can manage own pdfs'
    ) THEN
        CREATE POLICY "Users can manage own pdfs"
            ON storage.objects
            FOR ALL
            TO authenticated
            USING (bucket_id = 'pdfs' AND auth.uid()::text = (storage.foldername(name))[1])
            WITH CHECK (bucket_id = 'pdfs' AND auth.uid()::text = (storage.foldername(name))[1]);
    END IF;
END $$;

-- Handle users table
DO $$
BEGIN
    -- Create users table if it doesn't exist
    IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'users') THEN
        CREATE TABLE public.users (
            id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
            email text NOT NULL,
            created_at timestamptz DEFAULT now(),
            updated_at timestamptz DEFAULT now()
        );

        -- Enable RLS
        ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

        -- Create policy
        CREATE POLICY "Users can read own data"
            ON public.users
            FOR SELECT
            TO authenticated
            USING (auth.uid() = id);

        -- Create trigger
        CREATE TRIGGER update_users_updated_at
            BEFORE UPDATE ON users
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at();
    END IF;
END $$;

-- Create updated_at trigger function if it doesn't exist
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;