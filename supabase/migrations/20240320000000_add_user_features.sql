-- Add reading_statistics table
CREATE TABLE IF NOT EXISTS reading_statistics (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    pages_read integer NOT NULL DEFAULT 0,
    reading_time integer NOT NULL DEFAULT 0, -- in minutes
    books_completed integer NOT NULL DEFAULT 0,
    daily_average integer NOT NULL DEFAULT 0,
    weekly_data jsonb NOT NULL DEFAULT '[]'::jsonb,
    monthly_data jsonb NOT NULL DEFAULT '[]'::jsonb,
    weekly_change numeric(5,2) NOT NULL DEFAULT 0,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
);

-- Add challenges table
CREATE TABLE IF NOT EXISTS challenges (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    type text NOT NULL CHECK (type IN ('daily', 'weekly', 'monthly', 'special')),
    progress integer NOT NULL DEFAULT 0,
    total integer NOT NULL,
    days_left integer,
    reward text,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'failed')),
    start_date timestamptz DEFAULT now() NOT NULL,
    end_date timestamptz,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
);

-- Add missions table
CREATE TABLE IF NOT EXISTS missions (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    progress integer NOT NULL DEFAULT 0,
    icon_type text NOT NULL CHECK (icon_type IN ('target', 'trophy', 'book')),
    target_books jsonb DEFAULT '[]'::jsonb,
    target_tags jsonb DEFAULT '[]'::jsonb,
    start_date timestamptz DEFAULT now() NOT NULL,
    end_date timestamptz,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'paused')),
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
);

-- Add reading_activities table
CREATE TABLE IF NOT EXISTS reading_activities (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    book_id uuid REFERENCES books(id) ON DELETE CASCADE NOT NULL,
    type text NOT NULL CHECK (type IN ('started', 'finished', 'highlight', 'tagged', 'progress_update', 'challenge_completed', 'mission_completed')),
    details jsonb DEFAULT '{}'::jsonb,
    timestamp timestamptz DEFAULT now() NOT NULL
);

-- Add reading_sessions table
CREATE TABLE IF NOT EXISTS reading_sessions (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    book_id uuid REFERENCES books(id) ON DELETE CASCADE NOT NULL,
    start_time timestamptz NOT NULL,
    end_time timestamptz,
    pages_read integer DEFAULT 0,
    created_at timestamptz DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE reading_statistics ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE reading_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE reading_sessions ENABLE ROW LEVEL SECURITY;

-- Reading statistics policies
CREATE POLICY "Users can view their own reading statistics"
    ON reading_statistics FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own reading statistics"
    ON reading_statistics FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own reading statistics"
    ON reading_statistics FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Challenges policies
CREATE POLICY "Users can view their own challenges"
    ON challenges FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own challenges"
    ON challenges FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own challenges"
    ON challenges FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own challenges"
    ON challenges FOR DELETE
    USING (auth.uid() = user_id);

-- Missions policies
CREATE POLICY "Users can view their own missions"
    ON missions FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own missions"
    ON missions FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own missions"
    ON missions FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own missions"
    ON missions FOR DELETE
    USING (auth.uid() = user_id);

-- Reading activities policies
CREATE POLICY "Users can view their own reading activities"
    ON reading_activities FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own reading activities"
    ON reading_activities FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Reading sessions policies
CREATE POLICY "Users can view their own reading sessions"
    ON reading_sessions FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own reading sessions"
    ON reading_sessions FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own reading sessions"
    ON reading_sessions FOR UPDATE
    USING (auth.uid() = user_id);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_reading_statistics_user_id ON reading_statistics(user_id);
CREATE INDEX IF NOT EXISTS idx_challenges_user_id ON challenges(user_id);
CREATE INDEX IF NOT EXISTS idx_challenges_status ON challenges(status);
CREATE INDEX IF NOT EXISTS idx_missions_user_id ON missions(user_id);
CREATE INDEX IF NOT EXISTS idx_missions_status ON missions(status);
CREATE INDEX IF NOT EXISTS idx_reading_activities_user_id ON reading_activities(user_id);
CREATE INDEX IF NOT EXISTS idx_reading_activities_book_id ON reading_activities(book_id);
CREATE INDEX IF NOT EXISTS idx_reading_activities_timestamp ON reading_activities(timestamp);
CREATE INDEX IF NOT EXISTS idx_reading_sessions_user_id ON reading_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_reading_sessions_book_id ON reading_sessions(book_id);

-- Create function to automatically create reading statistics for new users
CREATE OR REPLACE FUNCTION create_user_reading_statistics()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO reading_statistics (user_id)
    VALUES (NEW.id);
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to automatically create reading statistics for new users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION create_user_reading_statistics(); 