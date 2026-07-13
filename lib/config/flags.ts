// Development mode flags
export const FLAGS = {
  // Force development mode regardless of NODE_ENV
  FORCE_DEV_MODE: process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_DEVELOPMENT === "true",

  // Development user configuration
  DEV_USER_ID: "37770da5-4fdb-4b75-9dc2-3bf9b2f90ed8",
  DEV_USER_EMAIL: "dev@properbooky.com",

  // Feature flags
  BYPASS_AUTH_IN_DEV: true,
} as const;
