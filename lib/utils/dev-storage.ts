import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import type { Database } from "@/types/database";
import { DEV_CONFIG, isDev, getDevStoragePath } from "@/lib/config/development";

// Helper to ensure development storage is set up
export async function ensureDevStorage() {
  if (!isDev()) return;

  const supabase = createClientComponentClient<Database>();

  try {
    // Check and create default buckets
    await Promise.all(
      Object.values(DEV_CONFIG.STORAGE).map(async (bucket) => {
        const { data: bucketExists } = await supabase.storage.getBucket(bucket);
        if (!bucketExists) {
          await supabase.storage.createBucket(bucket, {
            public: true,
            fileSizeLimit: 100 * 1024 * 1024, // 100MB
          });
        }
      })
    );

    // Upload default assets if they don't exist
    const defaultAssets = [
      {
        path: getDevStoragePath("DEFAULT_BOOKS_PATH", "sample.pdf"),
        file: DEV_CONFIG.ASSETS.DEFAULT_PDF,
      },
      {
        path: getDevStoragePath("DEFAULT_BOOKS_PATH", "sample.epub"),
        file: DEV_CONFIG.ASSETS.DEFAULT_EPUB,
      },
      {
        path: getDevStoragePath("DEFAULT_COVERS_PATH", "default-cover.jpg"),
        file: DEV_CONFIG.ASSETS.DEFAULT_BOOK_COVER,
      },
      {
        path: getDevStoragePath("USER_PROFILES_PATH", "default-avatar.png"),
        file: DEV_CONFIG.ASSETS.DEFAULT_AVATAR,
      },
    ];

    await Promise.all(
      defaultAssets.map(async ({ path, file }) => {
        const { data: exists } = await supabase.storage
          .from(DEV_CONFIG.STORAGE.BOOKS_BUCKET)
          .getPublicUrl(path);

        if (!exists) {
          const response = await fetch(file);
          const blob = await response.blob();
          await supabase.storage
            .from(DEV_CONFIG.STORAGE.BOOKS_BUCKET)
            .upload(path, blob, {
              cacheControl: "3600",
              upsert: true,
            });
        }
      })
    );

  } catch (error) {
    console.error("Error setting up development storage:", error);
  }
}

// Helper to get development storage URLs
export function getDevStorageUrl(path: string): string {
  if (!isDev()) return "";
  
  const supabase = createClientComponentClient<Database>();
  const { data } = supabase.storage
    .from(DEV_CONFIG.STORAGE.BOOKS_BUCKET)
    .getPublicUrl(path);

  return data.publicUrl;
} 