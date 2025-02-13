-- Drop the existing status check constraint
ALTER TABLE books DROP CONSTRAINT IF EXISTS books_status_check;

-- Add the new status check constraint that includes 'wishlist'
ALTER TABLE books 
  ADD CONSTRAINT books_status_check 
  CHECK (status IN ('unread', 'reading', 'completed', 'wishlist'));

-- Make format and file_url nullable for wishlist items
ALTER TABLE books
  ALTER COLUMN format DROP NOT NULL,
  ALTER COLUMN file_url DROP NOT NULL;

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_books_status ON books(status);
CREATE INDEX IF NOT EXISTS idx_books_wishlist_priority ON books(wishlist_priority) WHERE status = 'wishlist'; 