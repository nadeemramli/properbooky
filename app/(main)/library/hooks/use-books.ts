import { useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Book } from "../types";
import { uploadBookFile as uploadFile, deleteBookFile } from "../services/file-upload";

export function useBooks() {
  const uploadBookFile = useCallback(async (file: File) => {
    const supabase = createClient();
    const user = await supabase.auth.getUser();
    if (!user.data.user) throw new Error("User not authenticated");

    const { file_url } = await uploadFile(file, user.data.user.id);
    return file_url;
  }, []);

  // ... rest of the hook implementation
} 