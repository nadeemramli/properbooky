/*
  # Enhanced Authentication and Statistics Schema

  1. Updates
    - Enhanced user profiles
    - Reading statistics tracking
    - User challenges and missions
    - Improved book metadata handling

  2. Security
    - Enhanced RLS policies
    - Better auth integration
    
  3. Performance
    - Optimized indexes
    - Efficient statistics queries
*/

-- Drop existing tables if they exist (to avoid conflicts)
DROP TABLE IF EXISTS public.user_reading_stats CASCADE;
DROP TABLE IF EXISTS public.user_missions CASCADE;
DROP TABLE IF EXISTS public.user_challenges CASCADE;
DROP TABLE IF EXISTS public.reading_sessions CASCADE;
DROP TABLE IF EXISTS public.highlights CASCADE;
DROP TABLE IF EXISTS public.books CASCADE;

-- Create books table
CREATE TABLE public.books (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    title text NOT NULL,
    author text,
    format text NOT NULL CHECK (format IN ('pdf', 'epub')),
    file_url text,
    cover_url text,
    status text NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'reading', 'completed')),
    progress integer DEFAULT 0,
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    metadata jsonb DEFAULT '{}'::jsonb,
    priority_score integer DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    last_read timestamptz
);

-- Create reading_sessions table for tracking reading activity
CREATE TABLE IF NOT EXISTS public.reading_sessions (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    book_id uuid REFERENCES public.books(id) ON DELETE CASCADE,
    start_time timestamptz NOT NULL,
    end_time timestamptz NOT NULL,
    pages_read integer DEFAULT 0,
    minutes_read integer DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT reading_sessions_pages_read_check CHECK (pages_read >= 0),
    CONSTRAINT reading_sessions_minutes_read_check CHECK (minutes_read >= 0),
    CONSTRAINT reading_sessions_time_check CHECK (end_time > start_time)
);

-- Create user_challenges table for tracking reading challenges
CREATE TABLE IF NOT EXISTS public.user_challenges (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    total_reading_time integer DEFAULT 0,
    books_read integer DEFAULT 0,
    current_streak integer DEFAULT 0,
    longest_streak integer DEFAULT 0,
    last_read_date date,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT user_challenges_reading_time_check CHECK (total_reading_time >= 0),
    CONSTRAINT user_challenges_books_read_check CHECK (books_read >= 0),
    CONSTRAINT user_challenges_current_streak_check CHECK (current_streak >= 0),
    CONSTRAINT user_challenges_longest_streak_check CHECK (longest_streak >= 0)
);

-- Create user_missions table for tracking reading goals
CREATE TABLE IF NOT EXISTS public.user_missions (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    completed_books integer DEFAULT 0,
    reading_books integer DEFAULT 0,
    total_highlights integer DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT user_missions_completed_books_check CHECK (completed_books >= 0),
    CONSTRAINT user_missions_reading_books_check CHECK (reading_books >= 0),
    CONSTRAINT user_missions_total_highlights_check CHECK (total_highlights >= 0)
);

-- Create user_reading_stats table for detailed reading statistics
CREATE TABLE IF NOT EXISTS public.user_reading_stats (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    today_pages integer DEFAULT 0,
    today_minutes integer DEFAULT 0,
    week_pages integer DEFAULT 0,
    week_minutes integer DEFAULT 0,
    month_pages integer DEFAULT 0,
    month_minutes integer DEFAULT 0,
    last_updated timestamptz DEFAULT now(),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT user_reading_stats_today_pages_check CHECK (today_pages >= 0),
    CONSTRAINT user_reading_stats_today_minutes_check CHECK (today_minutes >= 0),
    CONSTRAINT user_reading_stats_week_pages_check CHECK (week_pages >= 0),
    CONSTRAINT user_reading_stats_week_minutes_check CHECK (week_minutes >= 0),
    CONSTRAINT user_reading_stats_month_pages_check CHECK (month_pages >= 0),
    CONSTRAINT user_reading_stats_month_minutes_check CHECK (month_minutes >= 0)
);

-- Create highlights table for storing book highlights
CREATE TABLE IF NOT EXISTS public.highlights (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    book_id uuid REFERENCES public.books(id) ON DELETE CASCADE,
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    text text NOT NULL,
    note text,
    page integer,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS books_user_id_idx ON public.books(user_id);
CREATE INDEX IF NOT EXISTS books_status_idx ON public.books(status);
CREATE INDEX IF NOT EXISTS books_priority_score_idx ON public.books(priority_score);
CREATE INDEX IF NOT EXISTS reading_sessions_user_id_idx ON public.reading_sessions(user_id);
CREATE INDEX IF NOT EXISTS reading_sessions_book_id_idx ON public.reading_sessions(book_id);
CREATE INDEX IF NOT EXISTS reading_sessions_start_time_idx ON public.reading_sessions(start_time);
CREATE INDEX IF NOT EXISTS user_challenges_user_id_idx ON public.user_challenges(user_id);
CREATE INDEX IF NOT EXISTS user_missions_user_id_idx ON public.user_missions(user_id);
CREATE INDEX IF NOT EXISTS user_reading_stats_user_id_idx ON public.user_reading_stats(user_id);
CREATE INDEX IF NOT EXISTS highlights_book_id_idx ON public.highlights(book_id);
CREATE INDEX IF NOT EXISTS highlights_user_id_idx ON public.highlights(user_id);

-- Enable RLS on all tables
ALTER TABLE public.books ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reading_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_reading_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.highlights ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for books
CREATE POLICY "Users can view own books"
    ON public.books FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create own books"
    ON public.books FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own books"
    ON public.books FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own books"
    ON public.books FOR DELETE
    USING (auth.uid() = user_id);

-- Create RLS policies for reading_sessions
CREATE POLICY "Users can view own reading sessions"
    ON public.reading_sessions FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create own reading sessions"
    ON public.reading_sessions FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own reading sessions"
    ON public.reading_sessions FOR UPDATE
    USING (auth.uid() = user_id);

-- Create RLS policies for user_challenges
CREATE POLICY "Users can view own challenges"
    ON public.user_challenges FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create own challenges"
    ON public.user_challenges FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own challenges"
    ON public.user_challenges FOR UPDATE
    USING (auth.uid() = user_id);

-- Create RLS policies for user_missions
CREATE POLICY "Users can view own missions"
    ON public.user_missions FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create own missions"
    ON public.user_missions FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own missions"
    ON public.user_missions FOR UPDATE
    USING (auth.uid() = user_id);

-- Create RLS policies for user_reading_stats
CREATE POLICY "Users can view own reading stats"
    ON public.user_reading_stats FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create own reading stats"
    ON public.user_reading_stats FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own reading stats"
    ON public.user_reading_stats FOR UPDATE
    USING (auth.uid() = user_id);

-- Create RLS policies for highlights
CREATE POLICY "Users can view own highlights"
    ON public.highlights FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create own highlights"
    ON public.highlights FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own highlights"
    ON public.highlights FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own highlights"
    ON public.highlights FOR DELETE
    USING (auth.uid() = user_id);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
DO $$
BEGIN
    -- Books
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'handle_books_updated_at'
    ) THEN
        CREATE TRIGGER handle_books_updated_at
            BEFORE UPDATE ON public.books
            FOR EACH ROW
            EXECUTE FUNCTION handle_updated_at();
    END IF;

    -- Reading Sessions
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'handle_reading_sessions_updated_at'
    ) THEN
        CREATE TRIGGER handle_reading_sessions_updated_at
            BEFORE UPDATE ON public.reading_sessions
            FOR EACH ROW
            EXECUTE FUNCTION handle_updated_at();
    END IF;

    -- User Challenges
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'handle_user_challenges_updated_at'
    ) THEN
        CREATE TRIGGER handle_user_challenges_updated_at
            BEFORE UPDATE ON public.user_challenges
            FOR EACH ROW
            EXECUTE FUNCTION handle_updated_at();
    END IF;

    -- User Missions
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'handle_user_missions_updated_at'
    ) THEN
        CREATE TRIGGER handle_user_missions_updated_at
            BEFORE UPDATE ON public.user_missions
            FOR EACH ROW
            EXECUTE FUNCTION handle_updated_at();
    END IF;

    -- User Reading Stats
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'handle_user_reading_stats_updated_at'
    ) THEN
        CREATE TRIGGER handle_user_reading_stats_updated_at
            BEFORE UPDATE ON public.user_reading_stats
            FOR EACH ROW
            EXECUTE FUNCTION handle_updated_at();
    END IF;

    -- Highlights
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'handle_highlights_updated_at'
    ) THEN
        CREATE TRIGGER handle_highlights_updated_at
            BEFORE UPDATE ON public.highlights
            FOR EACH ROW
            EXECUTE FUNCTION handle_updated_at();
    END IF;
END $$; 