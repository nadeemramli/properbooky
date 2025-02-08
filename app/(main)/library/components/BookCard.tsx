import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import type { Book, Tag } from "@/types/book";
import { getBookTags } from "@/lib/api";
import { TagBadge } from "./TagBadge";

interface BookCardProps {
  book: Book;
}

export function BookCard({ book }: BookCardProps) {
  const [tags, setTags] = useState<Tag[]>([]);

  useEffect(() => {
    loadTags();
  }, []);

  async function loadTags() {
    const bookTags = await getBookTags(book.id);
    setTags(bookTags);
  }

  return (
    <Link
      href={`/books/${book.id}`}
      className="group relative flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white"
    >
      <div className="aspect-h-4 aspect-w-3 bg-gray-200 sm:aspect-none sm:h-96">
        {book.cover_url ? (
          <Image
            src={book.cover_url}
            alt={book.title}
            className="h-full w-full object-cover object-center sm:h-full sm:w-full"
            width={300}
            height={400}
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-gray-100">
            <span className="text-gray-400">No cover</span>
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col space-y-2 p-4">
        <h3 className="text-sm font-medium text-gray-900">{book.title}</h3>
        <p className="text-sm text-gray-500">{book.author}</p>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => (
              <TagBadge key={tag.id} tag={tag} />
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
