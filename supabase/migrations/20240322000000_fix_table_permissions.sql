-- Fix table permissions for authenticated users
BEGIN;

-- Grant usage on the uuid-ossp extension first
GRANT USAGE ON SCHEMA extensions TO authenticated;
GRANT EXECUTE ON FUNCTION extensions.uuid_generate_v4() TO authenticated;

-- Grant permissions in order of table dependencies
GRANT SELECT, INSERT, UPDATE, DELETE ON books TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON highlights TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON tags TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON obsidian_sync TO authenticated;

-- Update books table to support wishlist
ALTER TABLE books
  ALTER COLUMN format DROP NOT NULL,
  ALTER COLUMN file_url DROP NOT NULL,
  ADD COLUMN wishlist_added_date TIMESTAMP WITH TIME ZONE,
  ADD COLUMN wishlist_priority INTEGER,
  ADD COLUMN wishlist_source TEXT,
  ADD COLUMN wishlist_reason TEXT;

-- Add new status enum value
ALTER TYPE book_status ADD VALUE IF NOT EXISTS 'wishlist';

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_books_status ON books(status);
CREATE INDEX IF NOT EXISTS idx_books_wishlist_priority ON books(wishlist_priority) WHERE status = 'wishlist';
CREATE INDEX IF NOT EXISTS idx_books_wishlist_added_date ON books(wishlist_added_date) WHERE status = 'wishlist';

-- Update metadata JSONB validation
CREATE OR REPLACE FUNCTION validate_book_metadata()
RETURNS trigger AS $$
BEGIN
  IF NEW.metadata IS NULL THEN
    NEW.metadata := '{}'::jsonb;
  END IF;

  -- Ensure metadata is a JSONB object
  IF jsonb_typeof(NEW.metadata) != 'object' THEN
    RAISE EXCEPTION 'metadata must be a JSON object';
  END IF;

  -- Validate metadata fields
  IF NEW.metadata ? 'isbn' AND NOT (
    NEW.metadata->>'isbn' ~ '^[0-9-]{10,17}$'
  ) THEN
    RAISE EXCEPTION 'invalid ISBN format';
  END IF;

  IF NEW.metadata ? 'language' AND NOT (
    NEW.metadata->>'language' ~ '^[a-z]{2,3}(-[A-Z]{2})?$'
  ) THEN
    RAISE EXCEPTION 'invalid language code format';
  END IF;

  IF NEW.metadata ? 'pages' AND NOT (
    (NEW.metadata->>'pages')::integer > 0
  ) THEN
    RAISE EXCEPTION 'pages must be a positive integer';
  END IF;

  IF NEW.metadata ? 'priority' AND NOT (
    (NEW.metadata->>'priority')::integer BETWEEN 0 AND 10
  ) THEN
    RAISE EXCEPTION 'priority must be between 0 and 10';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for metadata validation
DROP TRIGGER IF EXISTS validate_book_metadata_trigger ON books;
CREATE TRIGGER validate_book_metadata_trigger
  BEFORE INSERT OR UPDATE ON books
  FOR EACH ROW
  EXECUTE FUNCTION validate_book_metadata();

-- Update RLS policies
ALTER TABLE books ENABLE ROW LEVEL SECURITY;

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

COMMIT; 