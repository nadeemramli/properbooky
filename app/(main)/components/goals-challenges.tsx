"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trophy, Target, Clock, Flame } from "lucide-react";
import { useEffect, useState } from "react";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";

interface Challenge {
  id: string;
  title: string;
  description: string;
  type: "daily" | "weekly" | "monthly" | "special";
  progress: number;
  total: number;
  daysLeft?: number;
  reward?: string;
  user_id: string;
  created_at: string;
  updated_at: string;
}

function ChallengeIcon({ type }: { type: Challenge["type"] }) {
  switch (type) {
    case "daily":
      return <Flame className="h-4 w-4" />;
    case "weekly":
      return <Target className="h-4 w-4" />;
    case "monthly":
      return <Trophy className="h-4 w-4" />;
    default:
      return <Trophy className="h-4 w-4" />;
  }
}

function ChallengeTypeBadge({ type }: { type: Challenge["type"] }) {
  const colors = {
    daily: "bg-red-100 text-red-800",
    weekly: "bg-blue-100 text-blue-800",
    monthly: "bg-purple-100 text-purple-800",
    special: "bg-yellow-100 text-yellow-800",
  };

  return (
    <Badge variant="secondary" className={colors[type]}>
      {type.charAt(0).toUpperCase() + type.slice(1)}
    </Badge>
  );
}

export function GoalsChallenges() {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClientComponentClient();

  useEffect(() => {
    async function fetchChallenges() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        const { data, error } = await supabase
          .from("challenges")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false });

        if (error) throw error;
        setChallenges(data || []);
      } catch (error) {
        console.error("Error fetching challenges:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchChallenges();
  }, [supabase]);

  if (loading) {
    return <div>Loading challenges...</div>;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Active Challenges</CardTitle>
          <Badge variant="secondary" className="bg-green-100 text-green-800">
            {challenges.length} Active
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[300px] pr-4">
          <div className="space-y-4">
            {challenges.map((challenge) => (
              <div
                key={challenge.id}
                className="rounded-lg border p-4 space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-2">
                    <ChallengeIcon type={challenge.type} />
                    <div>
                      <h4 className="font-semibold">{challenge.title}</h4>
                      <p className="text-sm text-muted-foreground">
                        {challenge.description}
                      </p>
                    </div>
                  </div>
                  <ChallengeTypeBadge type={challenge.type} />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Progress</span>
                    <span>
                      {challenge.progress} / {challenge.total}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{
                        width: `${
                          (challenge.progress / challenge.total) * 100
                        }%`,
                      }}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between text-sm">
                  {challenge.daysLeft && (
                    <div className="flex items-center text-muted-foreground">
                      <Clock className="mr-1 h-4 w-4" />
                      {challenge.daysLeft} days left
                    </div>
                  )}
                  {challenge.reward && (
                    <div className="flex items-center text-muted-foreground">
                      <Trophy className="mr-1 h-4 w-4" />
                      {challenge.reward}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
