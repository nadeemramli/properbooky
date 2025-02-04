import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import type { Database } from '@/types/supabase';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const supabase = createRouteHandlerClient<Database>({ cookies });

    // Get the current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    if (!user) throw new Error('Not authenticated');

    // Call the Edge Functions
    const functions = [
      'update-reading-stats',
      'update-challenges',
      'update-missions'
    ];

    await Promise.all(functions.map(async (func) => {
      const response = await fetch(
        `${process.env['NEXT_PUBLIC_SUPABASE_URL']}/functions/v1/${func}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env['SUPABASE_SERVICE_ROLE_KEY']}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to call ${func}: ${response.statusText}`);
      }
    }));

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error updating stats:', error);
    return NextResponse.json(
      { error: error?.message || 'An unknown error occurred' },
      { status: 500 }
    );
  }
} 