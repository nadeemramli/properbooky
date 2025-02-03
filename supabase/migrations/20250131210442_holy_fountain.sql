/*
  # Initial Database Schema

  1. Tables
    - Users (Extended from auth.users)
    - Books (User's library)
    - Highlights (Book annotations)
    - Tags (Hierarchical organization)

  2. Security
    - RLS policies for all tables
    - Storage bucket policies
    
  3. Indexes
    - Full-text search capabilities
    - GIN indexes for JSON/JSONB
*/

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create users table (this is new)
CREATE TABLE public.users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Drop existing types first
DROP TYPE IF EXISTS book_status CASCADE;
DROP TYPE IF EXISTS highlight_color CASCADE;

-- Modify existing books table
ALTER TABLE books 
    DROP COLUMN IF EXISTS author,
    DROP COLUMN IF EXISTS published_date,
    DROP COLUMN IF EXISTS isbn,
    DROP COLUMN IF EXISTS file_path,
    DROP COLUMN IF EXISTS current_page,
    DROP COLUMN IF EXISTS total_pages,
    DROP COLUMN IF EXISTS last_read_at;

-- Handle status column transition
ALTER TABLE books 
    DROP COLUMN IF EXISTS status;

ALTER TABLE books 
    ADD COLUMN status text DEFAULT 'unread' NOT NULL;

-- Update books format and status constraints
ALTER TABLE books 
    DROP CONSTRAINT IF EXISTS books_format_check,
    ADD CONSTRAINT books_format_check CHECK (format IN ('epub', 'pdf')),
    ADD CONSTRAINT books_status_check CHECK (status IN ('unread', 'reading', 'completed'));

-- Add metadata and search_vector to books
ALTER TABLE books 
    ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS search_vector tsvector 
    GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(metadata->>'author', '')), 'B') ||
        setweight(to_tsvector('english', coalesce(metadata->>'description', '')), 'C')
    ) STORED;

-- Modify highlights table
ALTER TABLE highlights
    DROP COLUMN IF EXISTS color,
    ADD COLUMN IF NOT EXISTS tags jsonb DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS search_vector tsvector 
    GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;

-- Drop existing highlight_tags table as we're moving to JSONB
DROP TABLE IF EXISTS highlight_tags;

-- Modify existing tags table
ALTER TABLE tags
    DROP CONSTRAINT IF EXISTS tags_parent_tag_id_fkey,
    DROP COLUMN IF EXISTS parent_tag_id,
    ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.tags(id),
    DROP CONSTRAINT IF EXISTS tags_name_user_id_key,
    ADD CONSTRAINT tags_name_user_id_parent_id_key UNIQUE (name, user_id, parent_id);

-- Create new indexes
CREATE INDEX IF NOT EXISTS books_search_idx ON public.books USING gin(search_vector);
CREATE INDEX IF NOT EXISTS highlights_search_idx ON public.highlights USING gin(search_vector);
CREATE INDEX IF NOT EXISTS highlights_tags_idx ON public.highlights USING gin(tags);
CREATE INDEX IF NOT EXISTS tags_parent_id_idx ON public.tags(parent_id);

-- Enable RLS on users table
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Create users policy (this is new)
CREATE POLICY "Users can read own data"
  ON public.users
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- Create storage buckets
INSERT INTO storage.buckets (id, name, public) VALUES 
  ('epubs', 'epubs', false),
  ('pdfs', 'pdfs', false);

-- Create storage policies
CREATE POLICY "Users can manage own epubs"
  ON storage.objects
  FOR ALL
  TO authenticated
  USING (bucket_id = 'epubs' AND auth.uid()::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'epubs' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can manage own pdfs"
  ON storage.objects
  FOR ALL
  TO authenticated
  USING (bucket_id = 'pdfs' AND auth.uid()::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'pdfs' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Create updated_at trigger function if it doesn't exist
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for users table (this is new)
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Drop the existing table if you want to recreate it (Option 1)
-- DROP TABLE IF EXISTS books CASCADE;

-- Or modify the existing table (Option 2)
ALTER TABLE books 
    DROP COLUMN IF EXISTS author,
    DROP COLUMN IF EXISTS published_date,
    DROP COLUMN IF EXISTS isbn,
    DROP COLUMN IF EXISTS file_path,
    DROP COLUMN IF EXISTS current_page,
    DROP COLUMN IF EXISTS total_pages,
    DROP COLUMN IF EXISTS last_read_at;

-- Update the format column
ALTER TABLE books 
    DROP CONSTRAINT IF EXISTS books_format_check,
    ADD CONSTRAINT books_format_check CHECK (format IN ('epub', 'pdf'));

-- Update the status column
ALTER TABLE books 
    ALTER COLUMN status TYPE text,
    ALTER COLUMN status SET DEFAULT 'unread',
    DROP CONSTRAINT IF EXISTS books_status_check,
    ADD CONSTRAINT books_status_check CHECK (status IN ('unread', 'reading', 'completed'));

-- Add search vector column if it doesn't exist
ALTER TABLE books 
    ADD COLUMN IF NOT EXISTS search_vector tsvector 
    GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(metadata->>'author', '')), 'B') ||
        setweight(to_tsvector('english', coalesce(metadata->>'description', '')), 'C')
    ) STORED;

-- Update indexes for modified tags table
DROP INDEX IF EXISTS tags_parent_tag_id_idx;
CREATE INDEX IF NOT EXISTS tags_parent_id_idx ON public.tags(parent_id);