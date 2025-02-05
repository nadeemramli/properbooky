import { Redis } from '@upstash/redis'

// Create a new Redis instance with environment variables
export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
})

// Helper function to check if Redis is connected
export async function checkRedisConnection() {
  try {
    await redis.ping()
    return true
  } catch (error) {
    console.error('Redis connection error:', error)
    return false
  }
}

// Helper function to create a rate limiter key
export function getRateLimitKey(identifier: string) {
  return `rate_limit:${identifier}`
}

// Helper function to increment rate limit count
export async function incrementRateLimit(key: string, ttl: number = 60) {
  try {
    const count = await redis.incr(key)
    // Set expiry on first increment
    if (count === 1) {
      await redis.expire(key, ttl)
    }
    return count
  } catch (error) {
    console.error('Rate limit increment error:', error)
    // Return 0 to allow the request in case of Redis failure
    return 0
  }
} 