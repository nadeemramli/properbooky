"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function SupabaseConnectionTest() {
  const [connectionStatus, setConnectionStatus] = useState<
    "loading" | "success" | "error"
  >("loading");
  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    async function testConnection() {
      try {
        const supabase = createClient();

        // Test the connection by trying to get the session
        const { data, error } = await supabase.auth.getSession();

        if (error) {
          throw error;
        }

        // If we get here, the connection is successful
        setConnectionStatus("success");
      } catch (error) {
        setConnectionStatus("error");
        setErrorMessage(
          error instanceof Error ? error.message : "An unknown error occurred"
        );
      }
    }

    testConnection();
  }, []);

  return (
    <div className="p-4 rounded-lg border">
      <h2 className="text-lg font-semibold mb-2">Supabase Connection Status</h2>
      <div className="flex items-center gap-2">
        <span>Status:</span>
        {connectionStatus === "loading" && (
          <span className="text-yellow-500">Testing connection...</span>
        )}
        {connectionStatus === "success" && (
          <span className="text-green-500">Connected successfully!</span>
        )}
        {connectionStatus === "error" && (
          <div>
            <span className="text-red-500">Connection failed</span>
            <p className="text-sm text-red-400 mt-1">{errorMessage}</p>
          </div>
        )}
      </div>
    </div>
  );
}
