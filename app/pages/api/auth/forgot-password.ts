import { withRateLimit } from '@/middleware/rateLimit';

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email } = req.body;
    
    // Send password reset email
    await sendPasswordResetEmail(email);
    
    return res.status(200).json({
      success: true,
      message: 'If an account exists with this email, you will receive password reset instructions shortly.'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'An error occurred while processing your request.'
    });
  }
};

export default withRateLimit(handler); 