-- Update the books bucket with additional configurations
UPDATE storage.buckets 
SET 
  file_size_limit = 104857600, -- 100MB limit
  allowed_mime_types = ARRAY['application/pdf', 'application/epub+zip']::text[]
WHERE id = 'books';

-- Drop existing policies to recreate with enhanced security
DROP POLICY IF EXISTS "Users can view own books" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload own books" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own books" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own books" ON storage.objects;

-- Recreate enhanced policies
CREATE POLICY "Users can view own books"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'books' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can upload own books"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'books' 
  AND auth.uid()::text = (storage.foldername(name))[1]
  AND (storage.extension(name) = 'pdf' OR storage.extension(name) = 'epub')
  AND (LOWER(storage.extension(name)) = 'pdf' OR LOWER(storage.extension(name)) = 'epub')
  AND length(name) < 255
);

CREATE POLICY "Users can update own books"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'books' 
  AND auth.uid()::text = (storage.foldername(name))[1]
)
WITH CHECK (
  bucket_id = 'books' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete own books"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'books' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Create additional index for performance
CREATE INDEX IF NOT EXISTS idx_storage_objects_bucket_name 
ON storage.objects USING btree (bucket_id, name);

-- Add updated_at trigger if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'update_storage_objects_updated_at'
  ) THEN
    CREATE TRIGGER update_storage_objects_updated_at
    BEFORE UPDATE ON storage.objects
    FOR EACH ROW
    EXECUTE FUNCTION storage.update_updated_at_column();
  END IF;
END $$; 