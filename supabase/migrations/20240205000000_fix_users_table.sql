-- Handle function drops first
DROP FUNCTION IF EXISTS handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS update_updated_at() CASCADE;

-- Create or replace the updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing users table and related objects
DROP TABLE IF EXISTS public.users CASCADE;

-- Create users table with the correct structure
CREATE TABLE public.users (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email text UNIQUE NOT NULL,
    name text,
    avatar_url text,
    provider text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Users can view own profile" ON public.users;
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.users;

-- Create policies
CREATE POLICY "Users can view own profile"
    ON public.users FOR SELECT
    TO authenticated
    USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
    ON public.users FOR UPDATE
    TO authenticated
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
    ON public.users FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = id);

-- Create updated_at trigger
DROP TRIGGER IF EXISTS update_users_updated_at ON public.users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Create index
DROP INDEX IF EXISTS idx_users_email;
CREATE INDEX idx_users_email ON public.users(email);

-- Create function to automatically create user profile
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
    _email text;
    _full_name text;
    _avatar_url text;
    _provider text;
BEGIN
    -- Check if user already exists
    IF EXISTS (SELECT 1 FROM public.users WHERE id = NEW.id) THEN
        RETURN NEW;
    END IF;

    -- Get values with proper error handling
    _email := COALESCE(NEW.email, '');
    _full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(_email, '@', 1));
    _avatar_url := COALESCE(NEW.raw_user_meta_data->>'avatar_url', '');
    _provider := COALESCE(NEW.raw_user_meta_data->>'provider', 'email');

    INSERT INTO public.users (id, email, name, avatar_url, provider, metadata)
    VALUES (
        NEW.id,
        _email,
        _full_name,
        _avatar_url,
        _provider,
        jsonb_build_object(
            'preferences', jsonb_build_object(
                'theme', 'system',
                'notifications', true
            )
        )
    );
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Log error details
    RAISE LOG 'Error in handle_new_user for user % : %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

-- Revoke all on public schema
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- Grant specific table permissions
GRANT SELECT, INSERT, UPDATE ON public.users TO authenticated;

-- Grant function execution permissions
GRANT EXECUTE ON FUNCTION handle_new_user() TO authenticated;
GRANT EXECUTE ON FUNCTION update_updated_at() TO authenticated;

-- Create trigger for automatic profile creation
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION handle_new_user(); 