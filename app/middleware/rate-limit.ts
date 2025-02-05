import rateLimit from 'express-rate-limit';
import type { NextApiRequest, NextApiResponse } from 'next';

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  message: {
    error: 'Too many requests, please try again later.',
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Helper function to wrap API routes with rate limiting
export function withRateLimit(
  handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void>
) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    try {
      await new Promise((resolve, reject) => {
        authRateLimiter(req, res, (result: Error | undefined) => {
          if (result) reject(result);
          resolve(result);
        });
      });
      await handler(req, res);
    } catch (error) {
      if (error instanceof Error) {
        res.status(429).json({
          error: 'Too Many Requests',
          message: error.message,
        });
      } else {
        res.status(429).json({
          error: 'Too Many Requests',
          message: 'Please try again later',
        });
      }
    }
  };
} 