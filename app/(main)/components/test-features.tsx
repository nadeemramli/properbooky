"use client";

import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import type { Database } from "@/types/supabase";

export function TestFeatures() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>("");
  const supabase = createClientComponentClient<Database>();

  const createTestData = async () => {
    try {
      setLoading(true);
      setResult("Creating test data...\n");

      // Get current user
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("Not authenticated");

      setResult((prev) => prev + "✓ Got current user\n");

      // 1. Create a daily challenge
      const { data: challenge, error: challengeError } = await supabase
        .from("challenges")
        .insert({
          user_id: user.id,
          title: "Daily Reading Goal",
          description: "Read for 30 minutes today",
          type: "daily",
          total: 30, // 30 minutes
          start_date: new Date().toISOString(),
          end_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours from now
        })
        .select()
        .single();

      if (challengeError) throw challengeError;
      setResult((prev) => prev + "✓ Created daily challenge\n");

      // 2. Create a mission
      const { data: mission, error: missionError } = await supabase
        .from("missions")
        .insert({
          user_id: user.id,
          title: "Complete Programming Books",
          description: "Read all programming books in your library",
          icon_type: "book",
          target_tags: ["programming", "software"],
        })
        .select()
        .single();

      if (missionError) throw missionError;
      setResult((prev) => prev + "✓ Created mission\n");

      // 3. Create a reading session
      const { data: books } = await supabase
        .from("books")
        .select("id")
        .eq("user_id", user.id)
        .limit(1)
        .single();

      if (books?.id) {
        const { error: sessionError } = await supabase
          .from("reading_sessions")
          .insert({
            user_id: user.id,
            book_id: books.id,
            start_time: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1 hour ago
            end_time: new Date().toISOString(),
            pages_read: 30,
          });

        if (sessionError) throw sessionError;
        setResult((prev) => prev + "✓ Created reading session\n");

        // 4. Create an activity
        const { error: activityError } = await supabase
          .from("reading_activities")
          .insert({
            user_id: user.id,
            book_id: books.id,
            type: "progress_update",
            details: { pages_read: 30, time_spent: 60 },
          });

        if (activityError) throw activityError;
        setResult((prev) => prev + "✓ Created activity\n");
      } else {
        throw new Error(
          "No books found in your library. Please add a book first."
        );
      }

      // 5. Trigger stats update
      const response = await fetch("/api/update-stats", {
        method: "POST",
      });

      if (!response.ok) throw new Error("Failed to update stats");
      setResult((prev) => prev + "✓ Updated statistics\n");

      setResult((prev) => prev + "\nAll test data created successfully!");
    } catch (error: any) {
      console.error("Error creating test data:", error);
      setResult(
        (prev) =>
          prev + `\nError: ${error?.message || "Unknown error occurred"}`
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 p-4">
      <Button
        variant="default"
        onClick={() => createTestData()}
        disabled={loading}
      >
        {loading ? "Creating Test Data..." : "Create Test Data"}
      </Button>
      {result && (
        <pre className="mt-4 p-4 bg-secondary rounded-lg whitespace-pre-wrap">
          {result}
        </pre>
      )}
    </div>
  );
}
