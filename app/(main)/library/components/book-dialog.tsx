"use client";

import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Plus,
  Upload,
  FileText,
  Loader2,
  X,
  AlertCircle,
  ChevronRight,
} from "lucide-react";
import { useBooks } from "@/lib/hooks/use-books";
import { useToast } from "@/components/ui/use-toast";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import Papa from "papaparse";
import { cn } from "@/lib/utils";
import type { BookCreate, BookMetadata, WishlistCSVRow } from "@/types/book";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useUploadQueue } from "@/lib/hooks/use-upload-queue";
import { useAuth } from "@/lib/hooks/use-auth";
import { useRouter } from "next/navigation";
import type { ParseError } from "papaparse";

const bookFormSchema = z.object({
  title: z.string().min(1, "Title is required"),
  author: z.string().nullable(),
  format: z.enum(["pdf", "epub"]),
  file_url: z.string().optional(),
  cover_url: z.string().nullable(),
  status: z
    .enum(["unread", "reading", "completed", "wishlist"])
    .default("unread"),
  progress: z.number().min(0).max(100).default(0),
  publication_year: z.number().nullable().optional(),
  description: z.string().nullable().optional(),
  isbn: z.string().nullable().optional(),
  publisher: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  pageCount: z.number().nullable().optional(),
  categories: z.array(z.string()).optional().default([]),
  metadata: z.record(z.any()).default({}),
});

type BookFormValues = z.infer<typeof bookFormSchema>;

interface BookDialogProps {
  mode?: "create" | "upload";
  trigger?: React.ReactNode;
}

interface QueueItem {
  id: string;
  file: File;
  progress: number;
  status: "pending" | "uploading" | "completed" | "error";
  error?: string;
}

type BookStatus = "completed" | "unread" | "reading" | "wishlist";

interface UploadedFile {
  file_url: string;
  metadata?: Partial<BookMetadata>;
}

export function BookDialog({ mode = "create", trigger }: BookDialogProps) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"manual" | "csv" | "bulk">(
    "manual"
  );
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showOptionalFields, setShowOptionalFields] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const { toast } = useToast();
  const { addBook, uploadBookFile } = useBooks();
  const { user } = useAuth();
  const router = useRouter();
  const {
    queue,
    isUploading,
    addToQueue,
    removeFromQueue,
    clearQueue,
    processQueue,
  } = useUploadQueue();

  const form = useForm<BookFormValues>({
    resolver: zodResolver(bookFormSchema),
    defaultValues: {
      title: "",
      author: null,
      format: "pdf",
      file_url: "",
      cover_url: null,
      status: "unread",
      progress: 0,
      publication_year: null,
      description: null,
      isbn: null,
      publisher: null,
      language: null,
      pageCount: null,
      categories: [],
      metadata: {},
    },
  });

  const onSubmit = async (values: BookFormValues) => {
    try {
      setIsSubmitting(true);

      if (!user) {
        throw new Error("User not authenticated");
      }

      let fileUrl = values.file_url;
      let fileMetadata = {};

      // Handle file upload if a file is selected
      if (selectedFile) {
        fileUrl = await uploadBookFile(selectedFile);
        // After successful upload, update uploadedFile state
        setUploadedFile({
          file_url: fileUrl,
          metadata: {}, // Add any extracted metadata here
        });
      }

      // Get metadata from uploadedFile state if available
      if (uploadedFile?.metadata) {
        fileMetadata = uploadedFile.metadata;
      }

      const bookData: BookCreate = {
        title: values.title,
        author: values.author || null,
        format: values.format as "pdf" | "epub",
        file_url: fileUrl || "",
        cover_url: values.cover_url || null,
        status: values.status || "unread",
        publication_year: values.publication_year || null,
        progress: values.progress || null,
        user_id: user.id,
        metadata: {
          ...values.metadata,
          ...fileMetadata,
        },
      };

      console.log("Creating book with data:", bookData);
      const result = await addBook(bookData);
      console.log("Book created successfully:", result);

      toast({
        title: "Success",
        description: "Book added successfully",
      });

      setOpen(false);
      form.reset();
      setSelectedFile(null);
    } catch (error) {
      console.error("Error creating book:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to create book",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // CSV Import functionality
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (file) {
        setSelectedFile(file);
        const format = getFileFormat(file.name);
        if (format) {
          form.setValue("format", format);
        }
      }
    },
    [form]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
      "application/epub+zip": [".epub"],
    },
    maxFiles: 1,
  });

  const handleCSVImport = () => {
    if (!user) {
      toast({
        title: "Error",
        description: "You must be logged in to import books",
        variant: "destructive",
      });
      return;
    }

    Papa.parse<WishlistCSVRow>(csvFile!, {
      header: true,
      complete: async (results) => {
        const books: BookCreate[] = results.data.map((row: any) => ({
          title: row.title,
          author: row.author || null,
          format: "pdf", // Default format
          file_url: "", // Empty for wishlist items
          cover_url: null,
          status: "wishlist",
          publication_year: null,
          progress: null,
          user_id: user.id,
          metadata: {
            isbn: row.isbn,
            wishlist_reason: row.reason,
            wishlist_source: row.source,
            wishlist_priority: row.priority
              ? parseInt(row.priority)
              : undefined,
            notes: row.notes,
            goodreads_url: row.goodreads_url,
            amazon_url: row.amazon_url,
            wishlist_added_date: new Date().toISOString(),
          },
        }));

        setUploadProgress(0);

        for (const bookData of books) {
          try {
            await addBook(bookData);
            setUploadProgress((prev) => prev + 100 / books.length);
          } catch (error: unknown) {
            console.error("Error adding book:", error);
            toast({
              variant: "destructive",
              title: "Error",
              description:
                error instanceof Error ? error.message : "Failed to add book",
            });
          }
        }

        toast({
          title: "Success",
          description: `Imported ${books.length} books`,
        });

        setOpen(false);
      },
      error: (error: Error) => {
        console.error("CSV parsing error:", error);
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to parse CSV file",
        });
      },
    });
  };

  // Bulk upload functionality
  const onBulkDrop = useCallback(
    (acceptedFiles: File[]) => {
      addToQueue(acceptedFiles);
    },
    [addToQueue]
  );

  const {
    getRootProps: getBulkRootProps,
    getInputProps: getBulkInputProps,
    isDragActive: isBulkDragActive,
  } = useDropzone({
    onDrop: onBulkDrop,
    accept: {
      "application/pdf": [".pdf"],
      "application/epub+zip": [".epub"],
    },
    maxSize: 100 * 1024 * 1024, // 100MB
    onError: (error: Error) => {
      console.error("Dropzone error:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to process file upload",
      });
    },
  });

  const handleBulkUpload = async () => {
    try {
      await processQueue();
      toast({
        title: "Upload Complete",
        description: `Successfully uploaded ${queue.length} files`,
      });
      setOpen(false);
      clearQueue();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Upload Failed",
        description:
          error instanceof Error ? error.message : "Failed to upload files",
      });
    }
  };

  // Reset state when dialog closes
  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      if (!isUploading) {
        clearQueue();
      }
      if (!isProcessing) {
        setCsvFile(null);
      }
      setSubmitError(null);
      form.reset();
    }
  };

  const defaultTrigger =
    mode === "upload" ? (
      <Button>
        <Upload className="mr-2 h-4 w-4" />
        Upload Book
      </Button>
    ) : (
      <Button variant="outline">
        <Plus className="mr-2 h-4 w-4" />
        Add Book
      </Button>
    );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger || defaultTrigger}</DialogTrigger>
      <DialogContent className="sm:max-w-[600px] h-[85vh] p-0 flex flex-col">
        <div className="px-6 pt-6 pb-0">
          <DialogHeader>
            <DialogTitle>
              {mode === "upload" ? "Upload Book" : "Add Book"}
            </DialogTitle>
            <DialogDescription>
              Add books to your collection manually or import from files
            </DialogDescription>
          </DialogHeader>
        </div>

        <Tabs
          defaultValue="manual"
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as any)}
          className="flex-1 flex flex-col"
        >
          <div className="border-b px-6">
            <TabsList className="bg-transparent -mb-px">
              <TabsTrigger
                value="manual"
                className="relative px-4 py-2 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-background data-[state=active]:shadow-[0_1px_0_0_#fff]"
              >
                Manual Entry
              </TabsTrigger>
              <TabsTrigger
                value="csv"
                className="relative px-4 py-2 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-background data-[state=active]:shadow-[0_1px_0_0_#fff]"
              >
                CSV Import
              </TabsTrigger>
              <TabsTrigger
                value="bulk"
                className="relative px-4 py-2 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-background data-[state=active]:shadow-[0_1px_0_0_#fff]"
              >
                Bulk Upload
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-none">
            <TabsContent
              value="manual"
              className="p-6 pt-4 data-[state=active]:flex flex-col h-full overflow-hidden"
            >
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit(onSubmit)}
                  className="flex flex-col h-full"
                >
                  <div className="flex-1 overflow-y-auto pr-2">
                    {submitError && (
                      <div className="rounded-md bg-destructive/15 p-3 mb-6">
                        <div className="flex">
                          <div className="flex-shrink-0">
                            <AlertCircle className="h-5 w-5 text-destructive" />
                          </div>
                          <div className="ml-3">
                            <h3 className="text-sm font-medium text-destructive">
                              Error
                            </h3>
                            <div className="mt-1 text-sm text-destructive/90">
                              {submitError}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Essential Information */}
                    <div className="space-y-4">
                      {mode === "upload" && (
                        <FormField
                          control={form.control}
                          name="file_url"
                          render={({
                            field: { value, onChange, ...field },
                          }) => (
                            <FormItem>
                              <FormLabel>Book File</FormLabel>
                              <FormControl>
                                <Input
                                  type="file"
                                  accept=".epub,.pdf"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    onChange(file);

                                    // Auto-fill title from filename if empty
                                    if (file && !form.getValues("title")) {
                                      const title = file.name
                                        .replace(/\.(epub|pdf)$/i, "")
                                        .replace(/[-_]/g, " ")
                                        .trim();
                                      form.setValue("title", title);
                                    }
                                  }}
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      )}

                      <div className="grid gap-4">
                        <FormField
                          control={form.control}
                          name="title"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Title</FormLabel>
                              <FormControl>
                                <Input
                                  {...field}
                                  placeholder="Enter book title"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <div className="grid grid-cols-2 gap-4">
                          <FormField
                            control={form.control}
                            name="author"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Author</FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    value={field.value || ""}
                                    placeholder="Author name"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="format"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Format</FormLabel>
                                <FormControl>
                                  <select
                                    {...field}
                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    <option value="pdf">PDF</option>
                                    <option value="epub">EPUB</option>
                                  </select>
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="sticky bottom-0 pt-4 mt-4 bg-background border-t">
                    <Button
                      type="submit"
                      disabled={isSubmitting}
                      className="w-full"
                    >
                      {isSubmitting && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      {isSubmitting
                        ? "Adding Book..."
                        : mode === "upload"
                        ? "Upload Book"
                        : "Add to Collection"}
                    </Button>
                  </div>
                </form>
              </Form>
            </TabsContent>

            <TabsContent
              value="csv"
              className="p-6 pt-4 data-[state=active]:flex flex-col"
            >
              <div className="space-y-6">
                <div
                  {...getRootProps()}
                  className={cn(
                    "border-2 border-dashed rounded-lg p-8 transition-colors",
                    "hover:border-primary/50 hover:bg-muted/50",
                    isDragActive
                      ? "border-primary bg-primary/5"
                      : "border-muted"
                  )}
                >
                  <input {...getInputProps()} />
                  <div className="flex flex-col items-center gap-2 text-center">
                    <FileText className="h-8 w-8 text-muted-foreground" />
                    {isDragActive ? (
                      <p className="text-primary">Drop the CSV file here ...</p>
                    ) : (
                      <>
                        <p className="text-sm text-muted-foreground">
                          Drag & drop a CSV file here, or click to select
                        </p>
                        <p className="text-xs text-muted-foreground/80">
                          Download the{" "}
                          <Button variant="link" className="h-auto p-0">
                            template
                          </Button>
                        </p>
                      </>
                    )}
                  </div>
                </div>

                {selectedFile && (
                  <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/50 p-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                      <span className="text-sm truncate">
                        {selectedFile.name}
                      </span>
                    </div>
                    {isProcessing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Button size="sm" onClick={handleCSVImport}>
                        Import
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent
              value="bulk"
              className="p-6 pt-4 data-[state=active]:flex flex-col"
            >
              <div className="space-y-6">
                <div
                  {...getBulkRootProps()}
                  className={cn(
                    "border-2 border-dashed rounded-lg p-8 transition-colors",
                    "hover:border-primary/50 hover:bg-muted/50",
                    isBulkDragActive
                      ? "border-primary bg-primary/5"
                      : "border-muted"
                  )}
                >
                  <input {...getBulkInputProps()} />
                  <div className="flex flex-col items-center gap-2 text-center">
                    <Upload className="h-8 w-8 text-muted-foreground" />
                    {isBulkDragActive ? (
                      <p className="text-primary">Drop the files here ...</p>
                    ) : (
                      <>
                        <p className="text-sm text-muted-foreground">
                          Drag & drop files here, or click to select files
                        </p>
                        <p className="text-xs text-muted-foreground/80">
                          Supports: PDF, EPUB (max 100MB)
                        </p>
                      </>
                    )}
                  </div>
                </div>

                {/* File List */}
                {queue.length > 0 && (
                  <ScrollArea className="h-[200px] rounded-md border border-muted p-4">
                    <div className="space-y-2">
                      {queue.map((item: QueueItem) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between gap-2 rounded-lg border border-muted bg-muted/50 p-2"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                            <span className="text-sm truncate">
                              {item.file.name}
                            </span>
                            {item.error && (
                              <span className="text-xs text-destructive truncate">
                                {item.error}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {item.status === "error" && (
                              <AlertCircle className="h-4 w-4 text-destructive" />
                            )}
                            {item.status === "uploading" && (
                              <div className="w-20">
                                <Progress
                                  value={item.progress}
                                  className="h-2"
                                />
                                <span className="text-xs text-muted-foreground">
                                  {item.progress}%
                                </span>
                              </div>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 hover:bg-muted"
                              onClick={() => removeFromQueue(item.id)}
                              disabled={
                                isUploading && item.status === "uploading"
                              }
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}

                {/* Upload Buttons */}
                {queue.length > 0 && (
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={clearQueue}
                      disabled={isUploading}
                    >
                      Clear All
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleBulkUpload}
                      disabled={isUploading || queue.length === 0}
                    >
                      {isUploading && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      {isUploading
                        ? "Uploading..."
                        : `Upload ${queue.length} files`}
                    </Button>
                  </div>
                )}
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function getFileFormat(filename: string): "epub" | "pdf" | null {
  const ext = filename.split(".").pop()?.toLowerCase();
  return ext === "epub" || ext === "pdf" ? ext : null;
}
