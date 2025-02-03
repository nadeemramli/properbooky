---
draft: true
title: "Technical Requirements Document"
date: "2025-02-01"
tags: 
---
Start of the prompt:
Push out the PRD markdown, and with this prompt.

You are a software architecture, with a great back-end development skills. Your task is tell me how can I build all this, but with a bias of back-end engineering. You need to tell me Deployment, Database Architecture, Tech Stack. I want to come up with the foundation first, some of the features can be build later on, but I want to setup the foundation first. Specifically, I will use Shadcn for the UI, Typescript and Javascript, Next.js and React for the front-end. I will deploy using the Supabase, using it's Postgres Database, Auth, and API You don't have to build out the code, I will prompt to bolt.new for the setup. 

- Improvement for next prompt. Also include the CI/CD pipeline, and setup both front-end and back-end deployment.
-----
Important thoughts from Deepseek:

Okay, let's see. The user wants to build a reading management app called Booky. They've provided a detailed PRD outlining features like library management, prioritization engine, integrated reader, Obsidian integration, and analytics. The focus is on the backend architecture, using Next.js/React for the frontend, Supabase for deployment, Postgres database, Auth, and API. They mentioned using Shadcn for UI, but that's frontend, so maybe not relevant here.

First, I need to outline the deployment strategy. Since they're using Supabase, that's already handling the backend services. So deployment would involve setting up Supabase project, connecting the Next.js app to it. But maybe they need to consider things like environment variables, CI/CD pipelines for frontend deployment. But since they mentioned Supabase, maybe they're using Supabase's hosting? Wait, Supabase is more about backend-as-a-service. So the frontend might be deployed on Vercel or Netlify, given it's Next.js. But the user specified deploying using Supabase, so perhaps they mean using Supabase's database, auth, and API, but deploying the Next.js app elsewhere. Hmm.

Next, database architecture. The app needs to manage users, books, highlights, tags, priorities, integrations with Obsidian, etc. So the database schema should include tables for Users, Books, Highlights, Tags, maybe a join table for book-tag relationships. Also, need to handle user authentication via Supabase Auth. The user mentioned Obsidian integration, which might require storing API tokens or OAuth credentials for bidirectional sync. Need to model the relationships properly. For example, a User has many Books, each Book has many Highlights, Tags can be associated with multiple Books, etc.

Tech stack: Frontend is Next.js, React, TypeScript, Shadcn. Backend: Since using Supabase, the backend is handled via Supabase's services—Postgres database, Auth, Storage (for files like EPUB/PDF?), and Edge Functions if needed. The user might need to write some serverless functions for more complex operations, like the prioritization engine or analytics. Also, integrating with Obsidian would require building a plugin, which is separate, but the backend needs to expose APIs for syncing data.

For the database schema, let's outline the tables:
- Users: id (UUID), created_at, email, etc. (handled by Supabase Auth)
- Books: id (UUID), user_id (references Users), title, author, format (EPUB/PDF), file_path (in Supabase Storage), metadata (JSONB for custom fields), status (wishlist, in-progress, etc.), priority_score, recommendation_source, etc.
- Highlights: id, book_id, user_id, content, page_number, color, tags (array of tag IDs), created_at
- Tags: id, user_id, name, parent_tag_id (for nested tags)
- Priorities: Maybe a table to store the weights for recommendation sources. Or could be part of the Books table as a JSONB field.
- ObsidianSync: user_id, obsidian_api_token, last_sync_time, etc.

Need to consider indexes for performance, especially on user_id since data is user-specific. Also, Full-text search for the unified search feature. Postgres has built-in full-text search, which can be used for searching titles, authors, highlights.

For the prioritization engine, calculating priority scores based on weighted sources. This might require a function or a trigger in the database to update the priority_score in Books whenever a recommendation source is added or updated. Alternatively, handle this in application logic using Supabase Edge Functions.

Analytics would involve aggregating data from the Books and Highlights tables. For example, calculating reading trends, time spent, etc. This could be done with SQL queries, perhaps materialized views if the data is large.

Storage of EPUB/PDF files: Supabase Storage can handle file uploads. Each book's file is stored in a bucket, with access controls based on user_id. Bulk upload would involve using Supabase's JavaScript client to upload multiple files and create corresponding Book records.

Authentication is handled by Supabase Auth, so the frontend can use Supabase's client libraries to manage user sessions.

Obsidian integration requires an external plugin. The backend needs an API endpoint for OAuth with Obsidian (if applicable), but Obsidian plugins typically interact with local files. Wait, the PRD mentions it's an external plugin built in Obsidian. So the plugin would communicate with the Booky backend. So the backend needs REST API endpoints for bidirectional sync. For example, endpoints to get highlights, update progress, push notes from Obsidian. These endpoints would use Supabase's PostgREST for auto-generated APIs, or custom Edge Functions if more control is needed.

Security considerations: Ensure that all data access is scoped to the authenticated user. Row-level security (RLS) in Supabase can enforce this. For example, each table has RLS policies that check if the user_id matches the authenticated user.

Tech stack summary:
- Frontend: Next.js (React), TypeScript, Shadcn UI
- Backend: Supabase (Postgres, Auth, Storage, Edge Functions)
- APIs: Supabase auto-generated APIs + custom Edge Functions
- Deployment: Frontend on Vercel (since Next.js), Supabase for backend services
- Obsidian Plugin: Built with TypeScript, communicates with Booky backend via REST API

Potential challenges:
- Handling large EPUB/PDF files in Supabase Storage, considering storage limits and costs.
- Efficient full-text search across books and highlights. Postgres full-text search might need optimization.
- Real-time sync with Obsidian, ensuring data consistency.
- Scalability if the user base grows, but Supabase should handle scaling Postgres and Storage.

Foundational steps:
1. Set up Supabase project with Postgres database, Auth, Storage.
2. Enable Row-Level Security on all tables.
3. Design and create database tables with proper relationships and indexes.
4. Implement authentication flow using Supabase Auth in Next.js.
5. Set up file upload to Supabase Storage for bulk EPUB/PDF uploads.
6. Create basic CRUD APIs using Supabase client libraries for managing books, highlights, tags.
7. Implement basic search using Postgres full-text search.
8. Develop the Obsidian plugin skeleton with OAuth and API communication.
9. Set up CI/CD for frontend deployment (e.g., Vercel).
10. Implement basic analytics queries using SQL.

This sets the foundation. More complex features like the prioritization engine and AI integration can be added later.

--------
Real Answer:
### **Back-End Architecture & Foundation Setup**

#### **Deployment Strategy**
- **Frontend**: Next.js app hosted on **Vercel** (optimized for static/SSR).  
- **Backend**: Fully managed via **Supabase** (Postgres, Auth, Storage, Edge Functions).  
- **CI/CD**:  
  - Frontend: Automatic Vercel deployments via GitHub/GitLab.  
  - Backend: Supabase migrations for schema changes.  
#### **Database Architecture**  
**Tables & Relationships** (with RLS enabled):  
1. **Users** (Supabase Auth):  
   - `id` (UUID, primary key), `email`, `created_at`.  

2. **Books**:  
   - `id` (UUID), `user_id` (references `Users.id`), `title`, `author`, `format` (EPUB/PDF), `file_path` (Supabase Storage path), `status` (Wish/In-Progress/Completed), `priority_score` (INT), `metadata` (JSONB: recommendation sources, custom fields).  

3. **Highlights**:  
   - `id` (UUID), `book_id` (references `Books.id`), `user_id`, `content`, `page`, `tags` (JSONB array), `created_at`.  

4. **Tags**:  
   - `id` (UUID), `user_id`, `name`, `parent_tag_id` (self-reference for nested tags).  

5. **ObsidianSync** (for plugin integration):  
   - `user_id`, `obsidian_api_token` (encrypted), `last_sync_time`.  

**Indexes**:  
- `Books(user_id, status, priority_score)` for fast filtering.  
- `Highlights(user_id, book_id)` + GIN index on `tags` for nested tagging.  
- Full-text search index on `Books.title`, `Books.author`, `Highlights.content`.  
#### **Tech Stack**  
| Layer         | Technology                          | Use Case                                                                 |  
|---------------|-------------------------------------|-------------------------------------------------------------------------|  
| **Frontend**  | Next.js 14, React, TypeScript       | UI components (Shadcn), dashboard, search, and reader interfaces.       |  
| **Backend**   | Supabase (Postgres, Auth, Storage)  | User auth, database, file storage, and auto-generated CRUD APIs.        |  
| **Services**  | Supabase Edge Functions (Deno)      | Custom logic for prioritization engine, Obsidian sync, and analytics.   |  
| **Analytics** | PostgreSQL + Materialized Views     | Pre-aggregate stats (e.g., pages/day, genre distribution).              |  
| **Search**    | PostgreSQL Full-Text Search         | Unified search across books, highlights, and metadata.                  |  

#### **Core Back-End Components**  
6. **Supabase Auth Integration**:  
   - Use `@supabase/auth-helpers-nextjs` for session management.  
   - RLS policies to restrict data access (e.g., `Books.user_id = auth.uid()`).  

7. **File Storage**:  
   - Supabase Storage buckets (`epubs`, `pdfs`) with RLS.  
   - Bulk upload via `@supabase/storage-js` (auto-tagging via Edge Functions).  

8. **Prioritization Engine**:  
   - Edge Function to calculate `priority_score` using weighted recommendation sources (stored in `Books.metadata`).  
   - Trigger recalculations on book addition/update.  

9. **Obsidian Sync**:  
   - REST API endpoints (via Edge Functions) for bidirectional sync:  
     - `GET /api/obsidian/highlights` (export to Obsidian).  
     - `POST /api/obsidian/notes` (import from Obsidian).  

10. **Search & Filtering**:  
   - Use Postgres `websearch_to_tsquery()` for unified search.  
   - Filter books by `status`, `priority_score`, and tags via Supabase client.  

Here’s how to optimize your **cost-free setup** and **GitHub CI/CD pipeline**, addressing gaps from the previous plan:

### **Cost-Free Architecture Adjustments**
1. **Supabase Free Tier Guardrails**:
   - **Database**: Stay under 500MB (free tier limit). Use `pg_cron` for periodic cleanup of unused data.
   - **Storage**: Use a single bucket for all files (1GB free). Compress EPUB/PDFs during upload with `sharp` or `pdf-lib`.
   - **Edge Functions**: Limit non-critical functions (e.g., analytics aggregation) to avoid exceeding 500K monthly invocations.

2. **Vercel Free Tier**:
   - Enable Automatic Static Optimization in Next.js to minimize serverless function usage.
   - Use Incremental Static Regeneration (ISR) for rarely changing pages (e.g., FAQ, landing page).

3. **GitHub Actions**:
   - **Optimize Workflows**: 
     - Cache dependencies (`npm ci`, Supabase CLI).
     - Skip redundant jobs for draft PRs.
   - **Secrets**: Store `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `VERCEL_TOKEN` in GitHub Secrets.

### **GitHub CI/CD Pipeline**
Add these workflows to `.github/workflows`:

#### 1. **Continuous Deployment** (`deploy.yml`):
```yaml
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: amondnet/vercel-action@v30
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          scope: ${{ secrets.VERCEL_ORG_ID }}
```

#### 2. **Database Migrations** (`migrate.yml`):
```yaml
name: Migrate DB
on:
  push:
    paths:
      - 'supabase/migrations/**'
jobs:
  migrate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
      - run: supabase db push --project-ref ${{ secrets.SUPABASE_PROJECT_ID }}
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
```

#### 3. **Tests & Linting** (`tests.yml`):
```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run lint
      - run: npm test
```

### **Additional Steps to Implement**
4. **Backup Strategy**:
   - Use `pg_dump` in a GitHub Action to auto-export Supabase data weekly to a private repo.
   - Store backups in GitHub Releases or a dedicated `backups/` folder.

5. **Rate Limiting**:
   - Use Supabase RLS to restrict write operations (e.g., `max_books_per_user` policy).
   - Add `redis` for caching (free tier via Redis Cloud) to reduce Supabase reads.

6. **Monitoring**:
   - Use `@sentry/nextjs` (free tier) for error tracking.
   - Add a status page with Upptime (Gitub Actions-based uptime monitor).

7. **Obsidian Plugin**:
   - Publish it to Obsidian’s community plugins list (free) and use GitHub Releases for updates.

### **Potential Pitfalls to Mitigate**
- **Supabase Project Sprawl**: Use separate projects for dev/staging/prod (all free tier).
- **Bandwidth Overages**: Enable Vercel’s bandwidth alerts and compress assets with `next-optimized-images`.
- **Edge Function Costs**: Test locally with `supabase functions serve` before deploying.
---

#### **Foundational Steps**  
11. **Initialize Supabase Project**:  
   - Create tables, enable RLS, and set up Storage buckets.  
   - Seed test data for development.  

12. **Next.js + Supabase Setup**:  
   - Integrate Auth and Storage SDKs.  
   - Build basic CRUD pages (Library, Book Profile).  

13. **Edge Functions Skeleton**:  
   - Deploy boilerplate functions for file processing and prioritization.  

14. **Obsidian Plugin MVP**:  
   - Use Obsidian’s API to read/write notes and sync with Booky’s Edge Functions.  

15. **Analytics Pipeline**:  
   - Create materialized views for `Reading Trends` and `Progress Aggregation`.  

---

#### **Future Extensions**  
- **AI Integration**: Use OpenAI/Llama for auto-tagging and priority ranking.  
- **Spaced Repetition**: Cron jobs (via Edge Functions) to trigger review nudges.  
- **Local-First Sync**: Integrate CRDTs (e.g., Yjs) for offline support.  

Start with the database schema and Supabase setup. Use `bolt.new` to scaffold the Next.js project with Supabase Auth and Storage preconfigured.




### **bolt.new Prompt**  
**Copy this exact text into bolt.new**:  
```
Create a Next.js 14 project with the following setup:  

**Core Stack**:  
- Frontend: React, TypeScript, Shadcn UI (pre-configured with `components/ui`).  
- Backend: Supabase (Postgres, Auth, Storage, Edge Functions).  
- Deployment: Vercel (optimized for static/ISR).  

**Key Requirements**:  
16. **Supabase Integration**:  
   - Preconfigured Auth helpers (`@supabase/auth-helpers-nextjs`).  
   - RLS policies for all tables (Books, Highlights, Users, Tags).  
   - Storage buckets (`epubs`, `pdfs`) with RLS.  
17. **Database Schema**:  
   - Tables: `Users` (UUID, email), `Books` (UUID, user_id, title, format, status, priority_score, metadata JSONB), `Highlights` (UUID, book_id, tags JSONB), `Tags` (UUID, nested structure).  
   - Indexes: Full-text search on Books/Highlights, GIN index on tags.  
18. **CI/CD**:  
   - GitHub Actions for:  
     - Vercel deployment on `main` push.  
     - Supabase migrations when `supabase/migrations` changes.  
     - Linting/testing on PRs.  
19. **Cost-Free Optimization**:  
   - Compress EPUB/PDFs during upload.  
   - ISR for static pages (FAQ, landing).  
20. **Initial Setup**:  
   - Example components:  
     - `Library.tsx` (grid/list view with Supabase fetch).  
     - `BookProfile.tsx` (tabs for metadata/notes).  
   - Edge Functions boilerplate for:  
     - Priority score calculation.  
     - Obsidian sync (OAuth, bidirectional API).  

**Future-Proofing**:  
- Folder structure for AI integration (e.g., `lib/ai`).  
- CRON job templates for analytics/materialized views.  
```

---

### **Next Steps After bolt.new Setup**  
21. **Initialize the Project**:  
   ```bash  
   npx bolt.new@latest  
   # Paste the above prompt when prompted  
   ```  
22. **Post-Setup Tasks**:  
   - Run:  
     ```bash  
     cd booky && npm install  
     ```  
   - Link Supabase:  
     ```bash  
     supabase login  
     supabase link --project-ref YOUR_SUPABASE_PROJECT_ID  
     ```  
   - Configure GitHub Secrets:  
     - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `VERCEL_TOKEN`, etc.  
23. **Verify Foundations**:  
   - Test Auth flow (`/login` page).  
   - Upload a test EPUB/PDF to confirm Storage RLS.  
   - Trigger a GitHub Actions run by pushing to `main`.  

Once done, you’ll have a working foundation. Let me know if you need help debugging! 🔧


