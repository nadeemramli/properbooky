"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Book, BookOpen, Bookmark, Tag } from "lucide-react";

type Activity = {
  id: string;
  type: "started" | "finished" | "highlight" | "tagged";
  book: string;
  timestamp: string;
  details?: string;
};

const activities: Activity[] = [
  {
    id: "1",
    type: "started",
    book: "The Pragmatic Programmer",
    timestamp: "2 hours ago",
  },
  {
    id: "2",
    type: "highlight",
    book: "Clean Code",
    timestamp: "4 hours ago",
    details: "Added 3 highlights in Chapter 5: Form",
  },
  {
    id: "3",
    type: "tagged",
    book: "Design Patterns",
    timestamp: "Yesterday",
    details: "Added tags: programming, reference",
  },
  {
    id: "4",
    type: "finished",
    book: "Zero to One",
    timestamp: "2 days ago",
  },
];

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

export function ActivityFeed() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Activity</CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-4">
            {activities.map((activity) => (
              <div
                key={activity.id}
                className="flex items-start space-x-4 rounded-lg border p-3"
              >
                <div className="mt-1">
                  <ActivityIcon type={activity.type} />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium leading-none">
                    {activity.book}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {activity.type === "started" && "Started reading"}
                    {activity.type === "finished" && "Finished reading"}
                    {activity.type === "highlight" && "Added highlights"}
                    {activity.type === "tagged" && "Updated tags"}
                  </p>
                  {activity.details && (
                    <p className="text-sm text-muted-foreground">
                      {activity.details}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {activity.timestamp}
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
