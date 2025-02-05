-- Clean up remaining stats-related objects safely
DO $$ 
BEGIN
    -- Drop specific triggers we know about
    DROP TRIGGER IF EXISTS on_auth_user_created_stats ON auth.users;
    DROP TRIGGER IF EXISTS create_user_reading_statistics ON auth.users;
    DROP TRIGGER IF EXISTS handle_reading_statistics ON auth.users;
    
    -- Drop known functions
    DROP FUNCTION IF EXISTS public.create_user_reading_statistics() CASCADE;
    DROP FUNCTION IF EXISTS public.handle_reading_statistics() CASCADE;
    DROP FUNCTION IF EXISTS public.update_reading_statistics() CASCADE;
    DROP FUNCTION IF EXISTS public.create_reading_statistics() CASCADE;
    
    -- Drop known tables
    DROP TABLE IF EXISTS public.reading_statistics CASCADE;
    DROP TABLE IF EXISTS public.user_reading_stats CASCADE;
    DROP TABLE IF EXISTS public.reading_stats CASCADE;
    DROP TABLE IF EXISTS public.statistics CASCADE;
    DROP TABLE IF EXISTS public.stats CASCADE;
    DROP TABLE IF EXISTS public.user_stats CASCADE;
    DROP TABLE IF EXISTS public.reading_activities CASCADE;
    DROP TABLE IF EXISTS public.reading_sessions CASCADE;
    DROP TABLE IF EXISTS public.user_reading_activities CASCADE;
    DROP TABLE IF EXISTS public.user_reading_sessions CASCADE;
END $$; 