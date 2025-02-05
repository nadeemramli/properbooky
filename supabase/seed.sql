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