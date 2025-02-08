-- Create tags table
CREATE TABLE IF NOT EXISTS tags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    color TEXT DEFAULT '#94A3B8', -- Default slate-400 color
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    UNIQUE(name, user_id)
);

-- Create book_tags junction table
CREATE TABLE IF NOT EXISTS book_tags (
    book_id UUID REFERENCES books(id) ON DELETE CASCADE NOT NULL,
    tag_id UUID REFERENCES tags(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    PRIMARY KEY (book_id, tag_id)
);

-- Enable RLS
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE book_tags ENABLE ROW LEVEL SECURITY;

-- Create policies for tags
CREATE POLICY "Users can view own tags"
    ON tags FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create own tags"
    ON tags FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own tags"
    ON tags FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own tags"
    ON tags FOR DELETE
    USING (auth.uid() = user_id);

-- Create policies for book_tags
CREATE POLICY "Users can view own book tags"
    ON book_tags FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create own book tags"
    ON book_tags FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own book tags"
    ON book_tags FOR DELETE
    USING (auth.uid() = user_id);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_tags_user_id ON tags(user_id);
CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
CREATE INDEX IF NOT EXISTS idx_book_tags_book_id ON book_tags(book_id);
CREATE INDEX IF NOT EXISTS idx_book_tags_tag_id ON book_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_book_tags_user_id ON book_tags(user_id);

-- Add updated_at trigger for tags
CREATE TRIGGER update_tags_updated_at
    BEFORE UPDATE ON tags
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column(); 