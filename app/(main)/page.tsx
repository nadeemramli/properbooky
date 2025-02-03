import { Metadata } from "next";
import { MissionBoard } from "./components/mission-board";
import { GoalsChallenges } from "./components/goals-challenges";
import { ActivityFeed } from "./components/activity-feed";
import { ReadingStats } from "./components/reading-stats";

export const metadata: Metadata = {
  title: "Dashboard - ProperBooky",
  description: "Your reading dashboard and activity overview.",
};

export default function HomePage() {
  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MissionBoard />
        <GoalsChallenges />
        <ActivityFeed />
        <ReadingStats />
      </div>
    </div>
  );
}
