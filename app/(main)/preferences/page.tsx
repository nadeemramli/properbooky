import { Metadata } from "next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserProfileForm } from "./components/user-profile-form";
import { SettingsForm } from "./components/settings-form";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Preferences - ProperBooky",
  description: "Manage your profile and application settings.",
};

export default function PreferencesPage() {
  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">Preferences</h2>
      </div>

      <Card className="p-6">
        <Tabs defaultValue="profile" className="space-y-4">
          <TabsList>
            <TabsTrigger value="profile">User Profile</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
          <TabsContent value="profile" className="space-y-4">
            <UserProfileForm />
          </TabsContent>
          <TabsContent value="settings" className="space-y-4">
            <SettingsForm />
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}
