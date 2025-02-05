import { NextResponse } from 'next/server';
import { sendPasswordResetEmail } from '@/app/auth/services/email-service';
import { z } from 'zod';

// Schema for validating the request body
const resetPasswordSchema = z.object({
  email: z.string().email(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    // Validate request body
    const { email } = resetPasswordSchema.parse(body);
    
    // Send password reset email
    await sendPasswordResetEmail(email);
    
    return NextResponse.json({ message: 'Password reset email sent successfully' });
  } catch (error) {
    console.error('Error in reset password route:', error);
    return NextResponse.json(
      { error: 'Failed to process password reset request' },
      { status: 500 }
    );
  }
} 