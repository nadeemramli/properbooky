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

-- Users table (extends auth.users)
CREATE TABLE public.users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Books table
CREATE TABLE public.books (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  format text CHECK (format IN ('epub', 'pdf')),
  status text DEFAULT 'unread' CHECK (status IN ('unread', 'reading', 'completed')),
  priority_score integer DEFAULT 0,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(metadata->>'author', '')), 'B') ||
    setweight(to_tsvector('english', coalesce(metadata->>'description', '')), 'C')
  ) STORED
);

-- Highlights table
CREATE TABLE public.highlights (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  book_id uuid REFERENCES public.books(id) ON DELETE CASCADE,
  content text NOT NULL,
  page_number integer,
  tags jsonb DEFAULT '[]',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('english', content)
  ) STORED
);

-- Tags table (hierarchical structure)
CREATE TABLE public.tags (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  parent_id uuid REFERENCES public.tags(id),
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (name, user_id, parent_id)
);

-- Indexes
CREATE INDEX books_user_id_idx ON public.books(user_id);
CREATE INDEX books_search_idx ON public.books USING gin(search_vector);
CREATE INDEX highlights_book_id_idx ON public.highlights(book_id);
CREATE INDEX highlights_search_idx ON public.highlights USING gin(search_vector);
CREATE INDEX highlights_tags_idx ON public.highlights USING gin(tags);
CREATE INDEX tags_user_id_idx ON public.tags(user_id);
CREATE INDEX tags_parent_id_idx ON public.tags(parent_id);

-- RLS Policies
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.books ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.highlights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;

-- Users policies
CREATE POLICY "Users can read own data"
  ON public.users
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- Books policies
CREATE POLICY "Users can CRUD own books"
  ON public.books
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Highlights policies
CREATE POLICY "Users can CRUD own highlights through books"
  ON public.highlights
  FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.books
    WHERE books.id = highlights.book_id
    AND books.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.books
    WHERE books.id = highlights.book_id
    AND books.user_id = auth.uid()
  ));

-- Tags policies
CREATE POLICY "Users can CRUD own tags"
  ON public.tags
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Storage configuration
INSERT INTO storage.buckets (id, name, public) VALUES 
  ('epubs', 'epubs', false),
  ('pdfs', 'pdfs', false);

-- Storage RLS policies
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

-- Functions
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_books_updated_at
  BEFORE UPDATE ON books
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_highlights_updated_at
  BEFORE UPDATE ON highlights
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_tags_updated_at
  BEFORE UPDATE ON tags
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();