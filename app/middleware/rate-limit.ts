import type { NextApiRequest, NextApiResponse } from 'next';
import { redis, getRateLimitKey, incrementRateLimit } from '@/lib/redis';

// Rate limit options
const RATE_LIMIT_OPTIONS = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
};

// Helper function to get client IP
function getIP(req: NextApiRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = typeof forwarded === 'string'
    ? forwarded.split(',')[0]
    : req.socket.remoteAddress;
  return ip || 'unknown';
}

// Helper function to wrap API routes with rate limiting
export function withRateLimit(
  handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void>
) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    try {
      const ip = getIP(req);
      const key = getRateLimitKey(`api:${ip}`);
      
      // Increment the counter for this IP
      const count = await incrementRateLimit(key, RATE_LIMIT_OPTIONS.windowMs / 1000);
      
      // Get remaining time for the current window
      const ttl = await redis.ttl(key);
      
      // If count exceeds limit, return rate limit response
      if (count > RATE_LIMIT_OPTIONS.max) {
        res.setHeader('Retry-After', ttl);
        res.status(429).json({
          error: 'Too Many Requests',
          message: `Too many requests, please try again in ${ttl} seconds.`,
        });
        return;
      }

      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', RATE_LIMIT_OPTIONS.max);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, RATE_LIMIT_OPTIONS.max - count));
      res.setHeader('X-RateLimit-Reset', Date.now() + (ttl * 1000));

      await handler(req, res);
    } catch (error) {
      console.error('Rate limit error:', error);
      // In case of Redis errors, allow the request to proceed
      await handler(req, res);
    }
  };
} 