"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { createClient } from "@/lib/supabase/client";
import { useEffect } from "react";
import type { User, UserMetadata } from "@/types/database";
import { db, isDbResultOk } from "@/lib/utils/database";
import { getErrorMessage } from "@/lib/utils/error";

const profileFormSchema = z.object({
  name: z
    .string()
    .min(2, "Name must be at least 2 characters.")
    .max(30, "Name must not be longer than 30 characters."),
  email: z.string().email("Invalid email address."),
  bio: z
    .string()
    .max(160, "Bio must not be longer than 160 characters.")
    .optional(),
  avatar_url: z.string().optional(),
});

type ProfileFormValues = z.infer<typeof profileFormSchema>;

export function UserProfileForm() {
  const supabase = createClient();
  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      name: "",
      email: "",
      bio: "",
      avatar_url: "",
    },
  });

  // Load user profile data
  useEffect(() => {
    async function loadUserProfile() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error("User not found");

        const result = await db.getUserProfile(user.id);
        if (!isDbResultOk(result)) {
          throw new Error(result.error?.message || "Failed to load profile");
        }

        const profile = result.data;

        // Set form values
        form.reset({
          name: profile.name || "",
          email: profile.email,
          bio: profile.metadata?.bio || "",
          avatar_url: profile.avatar_url || "",
        });
      } catch (error) {
        console.error("Error loading profile:", error);
        toast.error(getErrorMessage(error));
      }
    }

    loadUserProfile();
  }, [form, supabase]);

  async function onSubmit(data: ProfileFormValues) {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");

      const result = await db.updateUserProfile(user.id, {
        name: data.name,
        avatar_url: data.avatar_url,
        metadata: {
          bio: data.bio,
        },
      });

      if (!isDbResultOk(result)) {
        throw new Error(result.error?.message || "Failed to update profile");
      }

      toast.success("Profile updated successfully");
    } catch (error) {
      console.error("Error updating profile:", error);
      toast.error(getErrorMessage(error));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-x-6">
        <Avatar className="h-20 w-20">
          <AvatarImage
            src={form.watch("avatar_url") || "/placeholder-avatar.jpg"}
            alt="Profile picture"
          />
          <AvatarFallback>
            {form.watch("name")?.charAt(0)?.toUpperCase() || "U"}
          </AvatarFallback>
        </Avatar>
        <div>
          <Button variant="outline" size="sm">
            Change picture
          </Button>
          <p className="mt-2 text-sm text-muted-foreground">
            JPG, GIF or PNG. Max size of 2MB.
          </p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl>
                  <Input placeholder="Your name" {...field} />
                </FormControl>
                <FormDescription>
                  This is your public display name.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input
                    placeholder="your.email@example.com"
                    type="email"
                    disabled
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  Your email address is managed through your authentication
                  provider.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="bio"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Bio</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="Tell us a little bit about yourself"
                    className="resize-none"
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  Brief description for your profile. Max 160 characters.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="flex gap-4">
            <Button type="submit">Update profile</Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => form.reset()}
            >
              Reset
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
