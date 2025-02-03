import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { Database } from '@/lib/database.types.ts';

export const createClient = () => {
  const cookieStore = cookies();
  
  return createServerComponentClient<Database>({
    cookies: () => cookieStore
  });
};