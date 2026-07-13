import type { Database } from "@/types/database";
import { FLAGS } from "./flags";

export const DEV_CONFIG = {
  // Development environment flag
  IS_DEV: FLAGS.FORCE_DEV_MODE,

  // Default development user
  DEV_USER: {
    id: FLAGS.DEV_USER_ID,
    email: FLAGS.DEV_USER_EMAIL,
    role: "user",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },

  // Default storage paths
  STORAGE: {
    BOOKS_BUCKET: "books",
    DEFAULT_BOOKS_PATH: "default-books",
    DEFAULT_COVERS_PATH: "default-covers",
    USER_PROFILES_PATH: "user-profiles",
    ANALYTICS_PATH: "analytics",
  },

  // Default assets
  ASSETS: {
    DEFAULT_AVATAR: "/defaults/avatar.png",
    DEFAULT_BOOK_COVER: "/defaults/book-cover.jpg",
    DEFAULT_PDF: "/defaults/sample.pdf",
    DEFAULT_EPUB: "/defaults/sample.epub",
  },
} as const;

// Simple development mode check
export const isDev = () => FLAGS.FORCE_DEV_MODE;

// Simple dev user getter
export const getDevUser = () => (isDev() ? DEV_CONFIG.DEV_USER : null);

// Type-safe development user check
export function isDevUser(userId: string): boolean {
  return isDev() && userId === DEV_CONFIG.DEV_USER.id;
}

// Development storage helper
export function getDevStoragePath(type: keyof typeof DEV_CONFIG.STORAGE, path: string): string {
  return `${DEV_CONFIG.STORAGE[type]}/${path}`;
} 