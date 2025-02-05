"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Grid2X2, List } from "lucide-react";
import { useBooks } from "@/lib/hooks/use-books";
import type { Book } from "@/types/book";

interface LibraryProps {
  view: "grid" | "list";
  searchQuery?: string;
}

export function Library({ view, searchQuery }: LibraryProps) {
  const { books, loading, error } = useBooks(searchQuery);

  if (loading) {
    return <div>Loading...</div>;
  }

  if (error) {
    return <div>Error: {error}</div>;
  }

  return (
    <div
      className={
        view === "grid" ? "grid grid-cols-1 md:grid-cols-3 gap-6" : "space-y-4"
      }
    >
      {books.map((book: Book) => (
        <Card key={book.id}>
          <CardHeader>
            <CardTitle>{book.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <p>{book.author}</p>
            <p>{book.metadata.description}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
