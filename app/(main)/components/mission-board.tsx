"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Target, Book, Trophy } from "lucide-react";

export function MissionBoard() {
  const missions = [
    {
      title: "Daily Reading Goal",
      progress: 75,
      icon: <Target className="h-4 w-4" />,
      description: "Read for 30 minutes today",
    },
    {
      title: "Weekly Challenge",
      progress: 40,
      icon: <Trophy className="h-4 w-4" />,
      description: "Complete 2 books this week",
    },
    {
      title: "Monthly Goal",
      progress: 60,
      icon: <Book className="h-4 w-4" />,
      description: "Read 5 books from your wishlist",
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-medium">Mission Board</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {missions.map((mission) => (
            <div key={mission.title} className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  {mission.icon}
                  <span className="font-medium">{mission.title}</span>
                </div>
                <span className="text-sm text-muted-foreground">
                  {mission.progress}%
                </span>
              </div>
              <div className="space-y-1">
                <Progress value={mission.progress} />
                <p className="text-sm text-muted-foreground">
                  {mission.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
