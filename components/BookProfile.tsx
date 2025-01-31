'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface BookProfileProps {
  bookId: string;
}

export default function BookProfile({ bookId }: BookProfileProps) {
  const supabase = createClient();

  const { data: book, isLoading: bookLoading } = useQuery({
    queryKey: ['book', bookId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('books')
        .select('*')
        .eq('id', bookId)
        .single();

      if (error) throw error;
      return data;
    },
  });

  const { data: highlights, isLoading: highlightsLoading } = useQuery({
    queryKey: ['highlights', bookId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('highlights')
        .select('*')
        .eq('book_id', bookId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data;
    },
  });

  if (bookLoading || highlightsLoading) return <div>Loading...</div>;
  if (!book) return <div>Book not found</div>;

  return (
    <div className="container mx-auto py-8">
      <Card>
        <CardHeader>
          <CardTitle>{book.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="metadata">
            <TabsList>
              <TabsTrigger value="metadata">Metadata</TabsTrigger>
              <TabsTrigger value="highlights">Highlights</TabsTrigger>
              <TabsTrigger value="notes">Notes</TabsTrigger>
            </TabsList>

            <TabsContent value="metadata">
              <div className="space-y-4">
                <div>
                  <h3 className="font-medium">Format</h3>
                  <p>{book.format}</p>
                </div>
                <div>
                  <h3 className="font-medium">Status</h3>
                  <p>{book.status}</p>
                </div>
                <div>
                  <h3 className="font-medium">Priority Score</h3>
                  <p>{book.priority_score}</p>
                </div>
                {Object.entries(book.metadata || {}).map(([key, value]) => (
                  <div key={key}>
                    <h3 className="font-medium capitalize">{key}</h3>
                    <p>{String(value)}</p>
                  </div>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="highlights">
              <div className="space-y-4">
                {highlights?.map((highlight) => (
                  <Card key={highlight.id}>
                    <CardContent className="pt-6">
                      <blockquote className="border-l-2 pl-6 italic">
                        {highlight.content}
                      </blockquote>
                      {highlight.page_number && (
                        <p className="text-sm text-muted-foreground mt-2">
                          Page {highlight.page_number}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="notes">
              <p>Notes feature coming soon...</p>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}