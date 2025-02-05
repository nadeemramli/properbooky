import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { redis, getRateLimitKey, incrementRateLimit } from "@/lib/redis";

const MAX_REQUESTS = 5; // Maximum requests per minute
const WINDOW_SIZE = 60; // Window size in seconds (1 minute)

export async function withRateLimit(
  request: NextRequest,
  handler: () => Promise<NextResponse>
) {
  try {
    const ip = request.ip ?? "127.0.0.1";
    const key = getRateLimitKey(`auth:${ip}`);
    
    // Increment the counter for this IP
    const count = await incrementRateLimit(key, WINDOW_SIZE);
    
    // Get remaining time for the current window
    const ttl = await redis.ttl(key);
    
    // If count exceeds limit, return rate limit response
    if (count > MAX_REQUESTS) {
      return new NextResponse(
        JSON.stringify({
          error: "Too many requests",
          message: `Please try again in ${ttl} seconds`,
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "X-RateLimit-Limit": MAX_REQUESTS.toString(),
            "X-RateLimit-Remaining": Math.max(0, MAX_REQUESTS - count).toString(),
            "X-RateLimit-Reset": (Date.now() + ttl * 1000).toString(),
          },
        }
      );
    }

    // Add rate limit headers to successful responses
    const response = await handler();
    response.headers.set("X-RateLimit-Limit", MAX_REQUESTS.toString());
    response.headers.set(
      "X-RateLimit-Remaining",
      Math.max(0, MAX_REQUESTS - count).toString()
    );
    response.headers.set(
      "X-RateLimit-Reset",
      (Date.now() + ttl * 1000).toString()
    );

    return response;
  } catch (error) {
    console.error("Rate limit error:", error);
    // In case of Redis errors, allow the request to proceed
    return handler();
  }
} 