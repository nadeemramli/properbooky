'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Grid2X2, List } from 'lucide-react';

export default function Library() {
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const supabase = createClient();

  const { data: books, isLoading } = useQuery({
    queryKey: ['books'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('books')
        .select('*')
        .order('priority_score', { ascending: false });

      if (error) throw error;
      return data;
    },
  });

  if (isLoading) return <div>Loading...</div>;

  return (
    <div className="container mx-auto py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">My Library</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setView('grid')}
            className={`p-2 rounded ${
              view === 'grid' ? 'bg-primary text-primary-foreground' : 'bg-secondary'
            }`}
          >
            <Grid2X2 className="h-5 w-5" />
          </button>
          <button
            onClick={() => setView('list')}
            className={`p-2 rounded ${
              view === 'list' ? 'bg-primary text-primary-foreground' : 'bg-secondary'
            }`}
          >
            <List className="h-5 w-5" />
          </button>
        </div>
      </div>

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="reading">Reading</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
        </TabsList>

        <TabsContent value="all">
          <div className={view === 'grid' ? 'grid grid-cols-1 md:grid-cols-3 gap-6' : 'space-y-4'}>
            {books?.map((book) => (
              <Card key={book.id}>
                <CardHeader>
                  <CardTitle>{book.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Format: {book.format}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Status: {book.status}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}