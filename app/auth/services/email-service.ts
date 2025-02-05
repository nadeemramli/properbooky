import { createClient } from '@/lib/supabase/server';

/**
 * Sends a password reset email to the specified email address
 * @param email The email address to send the reset link to
 */
export async function sendPasswordResetEmail(email: string): Promise<void> {
  try {
    const supabase = createClient();
    
    // Use Supabase's built-in password reset functionality
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.NEXTAUTH_URL}/auth/reset-password`,
    });

    if (error) {
      console.error('Failed to send password reset email:', error);
      throw new Error('Failed to send password reset email');
    }
  } catch (error) {
    console.error('Error in sendPasswordResetEmail:', error);
    throw error;
  }
} 