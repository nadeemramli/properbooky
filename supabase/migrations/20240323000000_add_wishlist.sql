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

-- Add new columns to books table
ALTER TABLE books 
ADD COLUMN IF NOT EXISTS publication_year integer,
ADD COLUMN IF NOT EXISTS knowledge_spectrum decimal(3,2), -- 0.00 to 1.00
ADD COLUMN IF NOT EXISTS manual_rating decimal(3,2),      -- 0.00 to 5.00
ADD COLUMN IF NOT EXISTS wishlist_status text CHECK (wishlist_status IN ('pending', 'acquired', 'removed')),
ADD COLUMN IF NOT EXISTS wishlist_priority integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS wishlist_notes text,
ADD COLUMN IF NOT EXISTS wishlist_added_date timestamptz;

-- Create recommendations table
CREATE TABLE IF NOT EXISTS book_recommendations (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    book_id uuid REFERENCES books(id) ON DELETE CASCADE NOT NULL,
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    recommender_name text,
    recommendation_text text,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
);

-- Enable RLS for recommendations
ALTER TABLE book_recommendations ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for recommendations
CREATE POLICY "Users can view own book recommendations"
    ON book_recommendations FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create own book recommendations"
    ON book_recommendations FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own book recommendations"
    ON book_recommendations FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own book recommendations"
    ON book_recommendations FOR DELETE
    USING (auth.uid() = user_id);

-- Create user priority weights table
CREATE TABLE IF NOT EXISTS user_priority_weights (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    lindy_effect_weight decimal(3,2) NOT NULL,
    recommendation_weight decimal(3,2) NOT NULL,
    manual_rating_weight decimal(3,2) NOT NULL,
    knowledge_spectrum_weight decimal(3,2) NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    UNIQUE(user_id),
    CONSTRAINT weights_sum_to_one CHECK (
        lindy_effect_weight + 
        recommendation_weight + 
        manual_rating_weight + 
        knowledge_spectrum_weight = 1.00
    )
);

-- Enable RLS for priority weights
ALTER TABLE user_priority_weights ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for priority weights
CREATE POLICY "Users can view own priority weights"
    ON user_priority_weights FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can update own priority weights"
    ON user_priority_weights FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_books_wishlist_status ON books(wishlist_status);
CREATE INDEX IF NOT EXISTS idx_books_wishlist_priority ON books(wishlist_priority);
CREATE INDEX IF NOT EXISTS idx_books_publication_year ON books(publication_year);
CREATE INDEX IF NOT EXISTS idx_recommendations_book_id ON book_recommendations(book_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_user_id ON book_recommendations(user_id);

-- Create triggers for updated_at
CREATE TRIGGER update_book_recommendations_updated_at
    BEFORE UPDATE ON book_recommendations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_user_priority_weights_updated_at
    BEFORE UPDATE ON user_priority_weights
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Grant permissions to authenticated users
GRANT SELECT, INSERT, UPDATE, DELETE ON book_recommendations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON user_priority_weights TO authenticated;

-- Insert default weights for all users
INSERT INTO user_priority_weights (
    user_id,
    lindy_effect_weight,
    recommendation_weight,
    manual_rating_weight,
    knowledge_spectrum_weight
)
SELECT 
    id,
    0.35,  -- 35% for Lindy effect
    0.25,  -- 25% for recommendations
    0.25,  -- 25% for manual rating
    0.15   -- 15% for knowledge spectrum
FROM auth.users
ON CONFLICT (user_id) DO NOTHING; 