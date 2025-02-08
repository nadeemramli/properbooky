import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { Book, Tag, BookFormat } from "@/types/book";
import { getBookTags } from "@/lib/api";
import { TagSelector } from "./TagSelector";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const bookSchema = z.object({
  title: z.string().min(1, "Title is required"),
  author: z.string().nullable(),
  format: z.enum(["pdf", "epub"] as const),
  isbn: z.string().optional(),
  description: z.string().optional(),
  cover_url: z.string().optional(),
});

type BookFormData = z.infer<typeof bookSchema>;

interface BookFormProps {
  book?: Book;
  onSubmit: (data: BookFormData) => void;
  isSubmitting?: boolean;
}

export function BookForm({
  book,
  onSubmit,
  isSubmitting = false,
}: BookFormProps) {
  const [tags, setTags] = useState<Tag[]>([]);
  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
  } = useForm<BookFormData>({
    resolver: zodResolver(bookSchema),
    defaultValues: book
      ? {
          title: book.title,
          author: book.author || "",
          format: book.format || "pdf",
          isbn: book.metadata?.isbn,
          description: book.metadata?.description,
          cover_url: book.cover_url || undefined,
        }
      : {
          format: "pdf", // Default format
        },
  });

  const format = watch("format");

  useEffect(() => {
    if (book?.id) {
      loadTags();
    }
  }, [book?.id]);

  async function loadTags() {
    if (book?.id) {
      const bookTags = await getBookTags(book.id);
      setTags(bookTags);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label
          htmlFor="title"
          className="block text-sm font-medium text-gray-700"
        >
          Title
        </label>
        <input
          type="text"
          id="title"
          {...register("title")}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
        />
        {errors.title && (
          <p className="mt-1 text-sm text-red-600">{errors.title.message}</p>
        )}
      </div>

      <div>
        <label
          htmlFor="author"
          className="block text-sm font-medium text-gray-700"
        >
          Author
        </label>
        <input
          type="text"
          id="author"
          {...register("author")}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
        />
        {errors.author && (
          <p className="mt-1 text-sm text-red-600">{errors.author.message}</p>
        )}
      </div>

      <div>
        <label
          htmlFor="format"
          className="block text-sm font-medium text-gray-700"
        >
          Format
        </label>
        <Select
          value={format}
          onValueChange={(value: BookFormat) => setValue("format", value)}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select format" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pdf">PDF</SelectItem>
            <SelectItem value="epub">EPUB</SelectItem>
          </SelectContent>
        </Select>
        {errors.format && (
          <p className="mt-1 text-sm text-red-600">{errors.format.message}</p>
        )}
      </div>

      <div>
        <label
          htmlFor="isbn"
          className="block text-sm font-medium text-gray-700"
        >
          ISBN
        </label>
        <input
          type="text"
          id="isbn"
          {...register("isbn")}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
        />
        {errors.isbn && (
          <p className="mt-1 text-sm text-red-600">{errors.isbn.message}</p>
        )}
      </div>

      <div>
        <label
          htmlFor="description"
          className="block text-sm font-medium text-gray-700"
        >
          Description
        </label>
        <textarea
          id="description"
          rows={3}
          {...register("description")}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
        />
        {errors.description && (
          <p className="mt-1 text-sm text-red-600">
            {errors.description.message}
          </p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">Tags</label>
        {book?.id ? (
          <TagSelector
            bookId={book.id}
            currentTags={tags}
            onTagsChange={setTags}
          />
        ) : (
          <p className="text-sm text-gray-500">
            Save the book first to add tags
          </p>
        )}
      </div>

      <div>
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex justify-center rounded-md border border-transparent bg-indigo-600 py-2 px-4 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
        >
          {isSubmitting ? "Saving..." : "Save"}
        </button>
      </div>
    </form>
  );
}
