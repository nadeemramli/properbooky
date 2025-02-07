-- Add wishlist table
CREATE TABLE IF NOT EXISTS wishlists (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    book_id uuid REFERENCES books(id) ON DELETE CASCADE NOT NULL,
    priority integer DEFAULT 0,
    notes text,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'acquired', 'removed')),
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    UNIQUE(user_id, book_id)
);

-- Enable RLS
ALTER TABLE wishlists ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for wishlists
CREATE POLICY "Users can view own wishlists"
    ON wishlists FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create own wishlists"
    ON wishlists FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own wishlists"
    ON wishlists FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own wishlists"
    ON wishlists FOR DELETE
    USING (auth.uid() = user_id);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_wishlists_user_id ON wishlists(user_id);
CREATE INDEX IF NOT EXISTS idx_wishlists_book_id ON wishlists(book_id);
CREATE INDEX IF NOT EXISTS idx_wishlists_status ON wishlists(status);
CREATE INDEX IF NOT EXISTS idx_wishlists_priority ON wishlists(priority);

-- Create trigger for updated_at
CREATE TRIGGER update_wishlists_updated_at
    BEFORE UPDATE ON wishlists
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Grant permissions to authenticated users
GRANT SELECT, INSERT, UPDATE, DELETE ON wishlists TO authenticated; 