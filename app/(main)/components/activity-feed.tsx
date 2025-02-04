"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Book, BookOpen, Bookmark, Tag } from "lucide-react";
import { useEffect, useState } from "react";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";

interface Activity {
  id: string;
  type: "started" | "finished" | "highlight" | "tagged";
  book_id: string;
  book_title: string;
  timestamp: string;
  details?: string;
  user_id: string;
}

export function ActivityFeed() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClientComponentClient();

  useEffect(() => {
    async function fetchActivities() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        const { data, error } = await supabase
          .from("reading_activities")
          .select(
            `
            *,
            books (
              title
            )
          `
          )
          .eq("user_id", user.id)
          .order("timestamp", { ascending: false })
          .limit(10);

        if (error) throw error;

        const formattedActivities = data.map((activity) => ({
          ...activity,
          book_title: activity.books.title,
        }));

        setActivities(formattedActivities);
      } catch (error) {
        console.error("Error fetching activities:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchActivities();
  }, [supabase]);

  function ActivityIcon({ type }: { type: Activity["type"] }) {
    switch (type) {
      case "started":
        return <BookOpen className="h-4 w-4" />;
      case "finished":
        return <Book className="h-4 w-4" />;
      case "highlight":
        return <Bookmark className="h-4 w-4" />;
      case "tagged":
        return <Tag className="h-4 w-4" />;
    }
  }

  if (loading) {
    return <div>Loading activity feed...</div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity Feed</CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[300px]">
          <div className="space-y-4">
            {activities.map((activity) => (
              <div key={activity.id} className="flex items-start gap-4 text-sm">
                <ActivityIcon type={activity.type} />
                <div className="grid gap-1">
                  <p className="font-medium">{activity.book_title}</p>
                  {activity.details && (
                    <p className="text-muted-foreground">{activity.details}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {new Date(activity.timestamp).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
