"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Target, Book, Trophy } from "lucide-react";
import { useEffect, useState } from "react";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";

interface Mission {
  id: string;
  title: string;
  description: string;
  progress: number;
  icon_type: "target" | "trophy" | "book";
  user_id: string;
  created_at: string;
  updated_at: string;
}

export function MissionBoard() {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClientComponentClient();

  useEffect(() => {
    async function fetchMissions() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        const { data, error } = await supabase
          .from("missions")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false });

        if (error) throw error;
        setMissions(data || []);
      } catch (error) {
        console.error("Error fetching missions:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchMissions();
  }, [supabase]);

  const getIcon = (iconType: Mission["icon_type"]) => {
    switch (iconType) {
      case "target":
        return <Target className="h-4 w-4" />;
      case "trophy":
        return <Trophy className="h-4 w-4" />;
      case "book":
        return <Book className="h-4 w-4" />;
    }
  };

  if (loading) {
    return <div>Loading missions...</div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-medium">Mission Board</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {missions.map((mission) => (
            <div key={mission.id} className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  {getIcon(mission.icon_type)}
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
