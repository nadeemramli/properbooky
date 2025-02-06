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

COMMIT; 