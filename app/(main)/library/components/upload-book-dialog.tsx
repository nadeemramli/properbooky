"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Upload, Loader2 } from "lucide-react";
import { useBooks } from "@/lib/hooks/use-books";
import { useToast } from "@/components/ui/use-toast";
import { createClient } from "@/lib/supabase/client";

export function UploadBookDialog() {
  const [open, setOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const { addBook, uploadBookFile } = useBooks();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedFile) return;

    setIsUploading(true);
    const formData = new FormData(e.currentTarget);
    const supabase = createClient();

    try {
      // Upload the file to storage
      const filePath = await uploadBookFile(selectedFile);

      // Create the book entry in the database
      await addBook({
        title: formData.get("title") as string,
        author: (formData.get("author") as string) || null,
        cover_url: null,
        format: formData.get("format") as "epub" | "pdf",
        file_url: filePath,
        status: "unread",
        progress: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_read: null,
        user_id: (await supabase.auth.getUser()).data.user?.id || "",
        metadata: {
          description: (formData.get("description") as string) || undefined,
          isbn: (formData.get("isbn") as string) || undefined,
        },
      });

      setOpen(false);
      setSelectedFile(null);
      (e.target as HTMLFormElement).reset();

      toast({
        title: "Success",
        description: "Book uploaded successfully!",
      });
    } catch (error) {
      console.error("Error uploading book:", error);
      toast({
        title: "Error",
        description: "Failed to upload book. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Upload className="mr-2 h-4 w-4" />
          Upload Book
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload Book</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="file">Book File</Label>
            <Input
              id="file"
              type="file"
              accept=".epub,.pdf"
              onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input id="title" name="title" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="author">Author</Label>
            <Input id="author" name="author" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="format">Format</Label>
            <Select name="format" required defaultValue="epub">
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="epub">EPUB</SelectItem>
                <SelectItem value="pdf">PDF</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="isbn">ISBN</Label>
            <Input id="isbn" name="isbn" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" name="description" />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={isUploading || !selectedFile}>
              {isUploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isUploading ? "Uploading..." : "Upload"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
