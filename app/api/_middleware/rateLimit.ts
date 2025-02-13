import type { NextApiRequest, NextApiResponse } from 'next';
import type { Options } from 'express-rate-limit';
import rateLimit from 'express-rate-limit';

// Custom type for Next.js API middleware
type NextApiMiddleware = (
  req: NextApiRequest,
  res: NextApiResponse,
  next: (error?: Error) => void
) => void;

// Create a rate limiter instance with Next.js types
const createRateLimiter = (options: Partial<Options>): NextApiMiddleware => {
  const rateLimiter = rateLimit(options);
  return (req, res, next) => {
    // @ts-ignore - express-rate-limit types don't match Next.js but the implementation works
    return rateLimiter(req, res, next);
  };
};

export const authRateLimiter = createRateLimiter({
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
      await new Promise<void>((resolve, reject) => {
        authRateLimiter(req, res, (error?: Error) => {
          if (error) reject(error);
          resolve();
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
          message: 'Rate limit exceeded',
        });
      }
    }
  };
} 