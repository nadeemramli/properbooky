"use client";

import { useState } from "react";
import { useAuth } from "@/lib/hooks/use-auth";
import { useSupabase } from "@/lib/hooks/use-supabase";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { Database } from "@/lib/database.types";

type Book = Database["public"]["Tables"]["books"]["Insert"];

export function AuthDebug() {
  const { user, session } = useAuth();
  const { insert, remove } = useSupabase<"books">();
  const [testResult, setTestResult] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);

  // Test RLS by trying to insert a test book
  const testRLS = async () => {
    if (!user?.id) {
      toast.error("You must be logged in to run tests");
      return;
    }

    try {
      setIsLoading(true);
      setTestResult("Testing RLS...");

      // Test 1: Insert (only required fields)
      const testBook: Book = {
        title: "Test Book",
        file_url: "test.pdf",
        format: "pdf",
        status: "unread",
        user_id: user.id,
      };

      const { data: insertData, error: insertError } = await insert(
        "books",
        testBook
      );

      if (insertError) {
        console.error("Insert Error:", insertError);
        setTestResult(`❌ Insert Test Failed: ${insertError}`);
        toast.error("RLS insert test failed");
        return;
      }

      if (!insertData?.id) {
        setTestResult("❌ Insert Test Failed: No data returned");
        toast.error("RLS insert test failed");
        return;
      }

      setTestResult("✅ Insert Test Passed\nTesting delete...");

      // Test 2: Delete
      const { error: deleteError } = await remove("books", insertData.id);

      if (deleteError) {
        console.error("Delete Error:", deleteError);
        setTestResult(`❌ Delete Test Failed: ${deleteError}`);
        toast.error("RLS delete test failed");
        return;
      }

      // Test 3: Try to access another user's data (should fail)
      const unauthorizedBook: Book = {
        title: "Test Book",
        file_url: "test.pdf",
        format: "pdf",
        status: "unread",
        user_id: "some-other-user-id", // This should fail
      };

      const { error: unauthorizedError } = await insert(
        "books",
        unauthorizedBook
      );

      if (unauthorizedError) {
        setTestResult(
          "✅ All Tests Passed!\n" +
            "- Insert: Success\n" +
            "- Delete: Success\n" +
            "- Unauthorized Access: Blocked (Good!)"
        );
        toast.success("All RLS tests passed!");
      } else {
        setTestResult(
          "❌ Security Test Failed: Unauthorized insert was allowed!"
        );
        toast.error("Security test failed");
      }
    } catch (error) {
      console.error("Test Error:", error);
      setTestResult(
        `❌ Test Error: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
      toast.error("RLS test failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="rounded-lg border p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Auth Debug Info</h2>
        <Button onClick={testRLS} disabled={isLoading}>
          {isLoading ? "Testing..." : "Test RLS Policies"}
        </Button>
      </div>

      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <h3 className="font-medium">Basic Info</h3>
            <p>
              <strong>User ID:</strong> {user?.id || "Not logged in"}
            </p>
            <p>
              <strong>Email:</strong> {user?.email || "N/A"}
            </p>
            <p>
              <strong>Auth Status:</strong>{" "}
              {session ? "✅ Authenticated" : "❌ Not authenticated"}
            </p>
            <p>
              <strong>Last Sign In:</strong> {user?.last_sign_in_at || "N/A"}
            </p>
          </div>
          <div>
            <h3 className="font-medium">Session Info</h3>
            <p>
              <strong>Session ID:</strong>{" "}
              {session?.access_token ? "✅ Valid" : "❌ None"}
            </p>
            <p>
              <strong>Provider:</strong> {user?.app_metadata?.provider || "N/A"}
            </p>
            <p>
              <strong>Created At:</strong>{" "}
              {user?.created_at
                ? new Date(user.created_at).toLocaleString()
                : "N/A"}
            </p>
          </div>
        </div>
      </div>

      {testResult && (
        <div className="mt-4 p-3 bg-muted rounded-md">
          <h3 className="font-medium mb-2">RLS Test Results:</h3>
          <pre className="whitespace-pre-wrap text-sm">{testResult}</pre>
        </div>
      )}
    </div>
  );
}
