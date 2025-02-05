"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { testStorageConnection, uploadBookFile } from "../services/file-upload";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/use-toast";

export function StorageTest() {
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();

  const handleConnectionTest = async () => {
    setIsTestingConnection(true);
    try {
      const isConnected = await testStorageConnection();
      toast({
        title: isConnected ? "Success" : "Error",
        description: isConnected
          ? "Storage connection successful"
          : "Storage connection failed",
        variant: isConnected ? "default" : "destructive",
      });
    } catch (error) {
      console.error("Connection test error:", error);
      toast({
        title: "Error",
        description: "Failed to test connection",
        variant: "destructive",
      });
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleTestUpload = async () => {
    setIsUploading(true);
    try {
      // Create a test PDF file
      const blob = new Blob(["Test PDF content"], { type: "application/pdf" });
      const testFile = new File([blob], "test.pdf", {
        type: "application/pdf",
      });

      // Get current user
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        throw new Error("User not authenticated");
      }

      // Try uploading
      const result = await uploadBookFile(testFile, user.id);

      toast({
        title: "Success",
        description: `File uploaded successfully. URL: ${result.file_url}`,
      });

      // Optional: Try to fetch the uploaded file to verify
      const response = await fetch(result.file_url);
      if (!response.ok) {
        throw new Error("Failed to verify uploaded file");
      }
    } catch (error) {
      console.error("Upload test error:", error);
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Upload test failed",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-4 p-4 border rounded-lg">
      <h2 className="text-lg font-semibold">Storage Tests</h2>

      <div className="space-y-2">
        <Button
          onClick={handleConnectionTest}
          disabled={isTestingConnection}
          variant="outline"
        >
          {isTestingConnection ? "Testing..." : "Test Storage Connection"}
        </Button>

        <Button
          onClick={handleTestUpload}
          disabled={isUploading}
          variant="outline"
        >
          {isUploading ? "Uploading..." : "Test File Upload"}
        </Button>
      </div>
    </div>
  );
}
