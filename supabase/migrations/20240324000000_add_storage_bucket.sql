-- Create the storage bucket for books
INSERT INTO storage.buckets (id, name, public)
VALUES ('books', 'books', true)
ON CONFLICT (id) DO NOTHING;

-- Set up storage policies for the books bucket
CREATE POLICY "Users can view own books"
ON storage.objects FOR SELECT
USING (bucket_id = 'books' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can upload own books"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'books' 
  AND auth.uid()::text = (storage.foldername(name))[1]
  AND (storage.extension(name) = 'pdf' OR storage.extension(name) = 'epub')
);

CREATE POLICY "Users can update own books"
ON storage.objects FOR UPDATE
USING (bucket_id = 'books' AND auth.uid()::text = (storage.foldername(name))[1])
WITH CHECK (bucket_id = 'books' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete own books"
ON storage.objects FOR DELETE
USING (bucket_id = 'books' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Create an index on the name column for better performance
CREATE INDEX IF NOT EXISTS idx_storage_objects_name ON storage.objects USING btree (name); 