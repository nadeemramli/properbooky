-- Add indexes for better performance on default buckets
CREATE INDEX IF NOT EXISTS idx_storage_objects_default_books 
ON storage.objects(name) WHERE bucket_id = 'default-books';

CREATE INDEX IF NOT EXISTS idx_storage_objects_default_covers
ON storage.objects(name) WHERE bucket_id = 'default-covers';