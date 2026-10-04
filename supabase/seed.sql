-- Seed data for development and testing

-- Insert test users (these will be linked to auth.users)
INSERT INTO auth.users (id, email)
VALUES 
    ('d0fc7e7c-8e3a-4dc6-b6c3-c0b10b1fa0c8', 'test1@example.com'),
    ('d0fc7e7c-8e3a-4dc6-b6c3-c0b10b1fa0c9', 'test2@example.com');

-- Dev-mode account (NEXT_PUBLIC_DEVELOPMENT=true signs in as this user; see
-- lib/hooks/use-auth.ts). Seeded confirmed because local sign-ups require email
-- confirmation. Local-only credentials; the id matches FLAGS.DEV_USER_ID.
INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new
)
VALUES (
    '00000000-0000-0000-0000-000000000000', '37770da5-4fdb-4b75-9dc2-3bf9b2f90ed8',
    'authenticated', 'authenticated', 'dev@properbooky.com',
    extensions.crypt('development', extensions.gen_salt('bf')), now(),
    '{"provider": "email", "providers": ["email"]}', '{}', now(), now(), '', '', '', ''
);

INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
VALUES (
    gen_random_uuid(), '37770da5-4fdb-4b75-9dc2-3bf9b2f90ed8', '37770da5-4fdb-4b75-9dc2-3bf9b2f90ed8',
    '{"sub": "37770da5-4fdb-4b75-9dc2-3bf9b2f90ed8", "email": "dev@properbooky.com", "email_verified": true}',
    'email', now(), now(), now()
);

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