-- Seed data for development and testing

-- Insert test users (these will be linked to auth.users)
INSERT INTO auth.users (id, email)
VALUES 
    ('d0fc7e7c-8e3a-4dc6-b6c3-c0b10b1fa0c8', 'test1@example.com'),
    ('d0fc7e7c-8e3a-4dc6-b6c3-c0b10b1fa0c9', 'test2@example.com');

-- Insert sample books
INSERT INTO public.books (id, user_id, title, author, format, status, priority_score, metadata)
VALUES
    ('b1fc7e7c-8e3a-4dc6-b6c3-c0b10b1fa0c1', 'd0fc7e7c-8e3a-4dc6-b6c3-c0b10b1fa0c8', 'The Great Gatsby', 'F. Scott Fitzgerald', 'epub', 'reading', 8, '{"isbn": "9780743273565", "pages": 180, "publisher": "Scribner", "published_date": "1925-04-10"}'),
    ('b1fc7e7c-8e3a-4dc6-b6c3-c0b10b1fa0c2', 'd0fc7e7c-8e3a-4dc6-b6c3-c0b10b1fa0c8', '1984', 'George Orwell', 'pdf', 'unread', 5, '{"isbn": "9780451524935", "pages": 328, "publisher": "Signet Classic", "published_date": "1949-06-08"}'),
    ('b1fc7e7c-8e3a-4dc6-b6c3-c0b10b1fa0c3', 'd0fc7e7c-8e3a-4dc6-b6c3-c0b10b1fa0c9', 'To Kill a Mockingbird', 'Harper Lee', 'epub', 'completed', 10, '{"isbn": "9780446310789", "pages": 281, "publisher": "Grand Central Publishing", "published_date": "1960-07-11"}');

-- Insert highlights
INSERT INTO public.highlights (id, book_id, user_id, text, page)
VALUES
    (uuid_generate_v4(), 'b1fc7e7c-8e3a-4dc6-b6c3-c0b10b1fa0c1', 'd0fc7e7c-8e3a-4dc6-b6c3-c0b10b1fa0c8', 'So we beat on, boats against the current, borne back ceaselessly into the past.', 180),
    (uuid_generate_v4(), 'b1fc7e7c-8e3a-4dc6-b6c3-c0b10b1fa0c3', 'd0fc7e7c-8e3a-4dc6-b6c3-c0b10b1fa0c9', 'Until I feared I would lose it, I never loved to read. One does not love breathing.', 18);

-- Insert user challenges
INSERT INTO public.user_challenges (user_id, total_reading_time, books_read, current_streak, longest_streak, last_read_date)
VALUES
    ('d0fc7e7c-8e3a-4dc6-b6c3-c0b10b1fa0c8', 105, 1, 2, 5, CURRENT_DATE),
    ('d0fc7e7c-8e3a-4dc6-b6c3-c0b10b1fa0c9', 180, 1, 3, 3, CURRENT_DATE);

-- Insert user missions
INSERT INTO public.user_missions (user_id, completed_books, reading_books, total_highlights)
VALUES
    ('d0fc7e7c-8e3a-4dc6-b6c3-c0b10b1fa0c8', 0, 1, 1),
    ('d0fc7e7c-8e3a-4dc6-b6c3-c0b10b1fa0c9', 1, 0, 1);

-- Insert user reading stats
INSERT INTO public.user_reading_stats (user_id, today_pages, today_minutes, week_pages, week_minutes, month_pages, month_minutes)
VALUES
    ('d0fc7e7c-8e3a-4dc6-b6c3-c0b10b1fa0c8', 20, 60, 45, 105, 45, 105),
    ('d0fc7e7c-8e3a-4dc6-b6c3-c0b10b1fa0c9', 0, 0, 281, 180, 281, 180);

-- Insert reading statistics
INSERT INTO public.reading_statistics (user_id, pages_read, reading_time, books_completed, daily_average, weekly_data, monthly_data, weekly_change)
VALUES
    ('d0fc7e7c-8e3a-4dc6-b6c3-c0b10b1fa0c8', 45, 105, 0, 22, '[{"date": "2024-03-19", "pages": 25}, {"date": "2024-03-20", "pages": 20}]', '[{"date": "2024-03", "pages": 45}]', 100.00),
    ('d0fc7e7c-8e3a-4dc6-b6c3-c0b10b1fa0c9', 281, 180, 1, 93, '[{"date": "2024-03-17", "pages": 281}]', '[{"date": "2024-03", "pages": 281}]', 100.00);

-- Insert challenges
INSERT INTO public.challenges (user_id, title, description, type, progress, total, days_left, reward, status, start_date, end_date)
VALUES
    ('d0fc7e7c-8e3a-4dc6-b6c3-c0b10b1fa0c8', 'Read 30 minutes daily', 'Read for at least 30 minutes every day', 'daily', 60, 30, 1, 'Reading Warrior Badge', 'active', CURRENT_DATE, CURRENT_DATE + INTERVAL '1 day'),
    ('d0fc7e7c-8e3a-4dc6-b6c3-c0b10b1fa0c9', 'Complete 3 books', 'Finish reading three books this month', 'monthly', 1, 3, 12, 'Bookworm Badge', 'active', DATE_TRUNC('month', CURRENT_DATE), DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month');

-- Insert missions
INSERT INTO public.missions (user_id, title, description, progress, icon_type, target_books, target_tags, status)
VALUES
    ('d0fc7e7c-8e3a-4dc6-b6c3-c0b10b1fa0c8', 'Classic Literature', 'Read 3 classic literature books', 1, 'book', '["b1fc7e7c-8e3a-4dc6-b6c3-c0b10b1fa0c1", "b1fc7e7c-8e3a-4dc6-b6c3-c0b10b1fa0c2"]', '["classics"]', 'active'),
    ('d0fc7e7c-8e3a-4dc6-b6c3-c0b10b1fa0c9', 'Reading Marathon', 'Read for 10 hours total', 3, 'target', '[]', '[]', 'active');

-- Insert reading activities
INSERT INTO public.reading_activities (user_id, book_id, type, details)
VALUES
    ('d0fc7e7c-8e3a-4dc6-b6c3-c0b10b1fa0c8', 'b1fc7e7c-8e3a-4dc6-b6c3-c0b10b1fa0c1', 'started', '{"progress": 0}'),
    ('d0fc7e7c-8e3a-4dc6-b6c3-c0b10b1fa0c8', 'b1fc7e7c-8e3a-4dc6-b6c3-c0b10b1fa0c1', 'progress_update', '{"progress": 45}'),
    ('d0fc7e7c-8e3a-4dc6-b6c3-c0b10b1fa0c9', 'b1fc7e7c-8e3a-4dc6-b6c3-c0b10b1fa0c3', 'finished', '{"progress": 100}'); 