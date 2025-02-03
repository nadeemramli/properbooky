-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create ENUMs
CREATE TYPE book_status AS ENUM (
    'wishlist',
    'in_progress',
    'completed',
    'dropped',
    'on_hold'
);

CREATE TYPE highlight_color AS ENUM (
    'yellow',
    'green',
    'blue',
    'red',
    'purple'
);

-- Create Books table
CREATE TABLE IF NOT EXISTS books (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users NOT NULL,
    title TEXT NOT NULL,
    author TEXT,
    published_date DATE,
    isbn TEXT,
    format TEXT NOT NULL,
    file_path TEXT,
    status book_status NOT NULL DEFAULT 'wishlist',
    priority_score INTEGER,
    current_page INTEGER DEFAULT 0,
    total_pages INTEGER,
    last_read_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create Highlights table
CREATE TABLE IF NOT EXISTS highlights (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    book_id UUID REFERENCES books ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users NOT NULL,
    content TEXT NOT NULL,
    page_number INTEGER,
    color highlight_color DEFAULT 'yellow',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create Tags table
CREATE TABLE IF NOT EXISTS tags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users NOT NULL,
    name TEXT NOT NULL,
    parent_tag_id UUID REFERENCES tags(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, name)
);

-- Create junction table for highlights and tags
CREATE TABLE IF NOT EXISTS highlight_tags (
    highlight_id UUID REFERENCES highlights ON DELETE CASCADE,
    tag_id UUID REFERENCES tags ON DELETE CASCADE,
    PRIMARY KEY (highlight_id, tag_id)
);

-- Create ObsidianSync table
CREATE TABLE IF NOT EXISTS obsidian_sync (
    user_id UUID PRIMARY KEY REFERENCES auth.users,
    obsidian_api_token TEXT,
    last_sync_time TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_books_user_id ON books(user_id);
CREATE INDEX IF NOT EXISTS idx_books_status ON books(status);
CREATE INDEX IF NOT EXISTS idx_highlights_book_id ON highlights(book_id);
CREATE INDEX IF NOT EXISTS idx_highlights_user_id ON highlights(user_id);
CREATE INDEX IF NOT EXISTS idx_tags_user_id ON tags(user_id);

-- Enable Row Level Security (RLS)
ALTER TABLE books ENABLE ROW LEVEL SECURITY;
ALTER TABLE highlights ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE highlight_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE obsidian_sync ENABLE ROW LEVEL SECURITY;

-- Create RLS Policies
-- Books policies
CREATE POLICY "Users can view their own books"
    ON books FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own books"
    ON books FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own books"
    ON books FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own books"
    ON books FOR DELETE
    USING (auth.uid() = user_id);

-- Highlights policies
CREATE POLICY "Users can view their own highlights"
    ON highlights FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own highlights"
    ON highlights FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own highlights"
    ON highlights FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own highlights"
    ON highlights FOR DELETE
    USING (auth.uid() = user_id);

-- Tags policies
CREATE POLICY "Users can view their own tags"
    ON tags FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own tags"
    ON tags FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own tags"
    ON tags FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own tags"
    ON tags FOR DELETE
    USING (auth.uid() = user_id);

-- Highlight tags policies
CREATE POLICY "Users can view their own highlight tags"
    ON highlight_tags FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM highlights
        WHERE highlights.id = highlight_tags.highlight_id
        AND highlights.user_id = auth.uid()
    ));

CREATE POLICY "Users can insert their own highlight tags"
    ON highlight_tags FOR INSERT
    WITH CHECK (EXISTS (
        SELECT 1 FROM highlights
        WHERE highlights.id = highlight_tags.highlight_id
        AND highlights.user_id = auth.uid()
    ));

CREATE POLICY "Users can delete their own highlight tags"
    ON highlight_tags FOR DELETE
    USING (EXISTS (
        SELECT 1 FROM highlights
        WHERE highlights.id = highlight_tags.highlight_id
        AND highlights.user_id = auth.uid()
    ));

-- ObsidianSync policies
CREATE POLICY "Users can view their own obsidian sync"
    ON obsidian_sync FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own obsidian sync"
    ON obsidian_sync FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own obsidian sync"
    ON obsidian_sync FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for books table
CREATE TRIGGER update_books_updated_at
    BEFORE UPDATE ON books
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column(); 