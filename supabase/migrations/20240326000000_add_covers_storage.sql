-- Add policy for cover images
CREATE POLICY "Users can upload cover images"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'books' 
  AND (storage.foldername(name))[1] = 'covers'
  AND storage.extension(name) = 'jpg'
  AND length(name) < 255
);

-- Allow all authenticated users to view covers
CREATE POLICY "Anyone can view cover images"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'books' 
  AND (storage.foldername(name))[1] = 'covers'
);

-- Update allowed mime types to include jpeg
UPDATE storage.buckets 
SET allowed_mime_types = array_append(allowed_mime_types, 'image/jpeg')
WHERE id = 'books'; 