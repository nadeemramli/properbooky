import { withRateLimit } from '@/app/middleware/rate-limit';
import { sendPasswordResetEmail } from '@/app/auth/services/email-service';
import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@/lib/supabase/server';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const supabase = createClient();

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.NEXTAUTH_URL}/auth/reset-password`,
    });

    if (error) {
      console.error('Password reset error:', error);
      return res.status(400).json({ error: error.message });
    }

    // Send password reset email
    await sendPasswordResetEmail(email);

    return res.status(200).json({
      message: 'If an account exists with this email, you will receive password reset instructions.',
    });
  } catch (error) {
    console.error('Password reset error:', error);
    return res.status(500).json({
      error: 'An error occurred while processing your request.',
    });
  }
}

export default withRateLimit(handler); 