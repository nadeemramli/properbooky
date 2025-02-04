"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { useEffect, useState } from "react";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";

interface ReadingData {
  name: string;
  pages: number;
}

interface ReadingMetrics {
  pagesRead: number;
  readingTime: number;
  booksCompleted: number;
  dailyAverage: number;
  weeklyData: ReadingData[];
  monthlyData: ReadingData[];
  weeklyChange: number;
}

export function ReadingStats() {
  const [metrics, setMetrics] = useState<ReadingMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClientComponentClient();

  useEffect(() => {
    async function fetchReadingStats() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        // Fetch reading statistics from your database
        const { data: readingStats, error } = await supabase
          .from("reading_statistics")
          .select("*")
          .eq("user_id", user.id)
          .single();

        if (error) throw error;

        // Transform the data as needed
        setMetrics(readingStats);
      } catch (error) {
        console.error("Error fetching reading stats:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchReadingStats();
  }, [supabase]);

  if (loading) {
    return <div>Loading statistics...</div>;
  }

  if (!metrics) {
    return <div>No reading statistics available.</div>;
  }

  return (
    <Card className="col-span-2">
      <CardHeader>
        <CardTitle>Reading Statistics</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="weekly" className="space-y-4">
          <TabsList>
            <TabsTrigger value="weekly">Weekly</TabsTrigger>
            <TabsTrigger value="monthly">Monthly</TabsTrigger>
          </TabsList>
          <TabsContent value="weekly" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    Pages Read
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{metrics.pagesRead}</div>
                  <p className="text-xs text-muted-foreground">
                    {metrics.weeklyChange > 0 ? "+" : ""}
                    {metrics.weeklyChange}% from last week
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    Reading Time
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {(metrics.readingTime / 60).toFixed(1)}h
                  </div>
                  <p className="text-xs text-muted-foreground">
                    hours this week
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    Books Completed
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {metrics.booksCompleted}
                  </div>
                  <p className="text-xs text-muted-foreground">this week</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    Daily Average
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {metrics.dailyAverage}
                  </div>
                  <p className="text-xs text-muted-foreground">pages per day</p>
                </CardContent>
              </Card>
            </div>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={metrics.weeklyData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="pages" fill="#6366f1" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </TabsContent>
          <TabsContent value="monthly" className="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={metrics.monthlyData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="pages" fill="#6366f1" />
              </BarChart>
            </ResponsiveContainer>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
