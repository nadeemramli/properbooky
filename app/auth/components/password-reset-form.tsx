"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";

const formSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

type PasswordResetFormProps = {
  onBackToLogin: () => void;
};

export default function PasswordResetForm({
  onBackToLogin,
}: PasswordResetFormProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isRequestSent, setIsRequestSent] = useState(false);
  const supabase = createClient();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    try {
      setIsLoading(true);
      const { error } = await supabase.auth.resetPasswordForEmail(
        values.email,
        {
          redirectTo: `${window.location.origin}/auth/reset-password`,
        }
      );

      if (error) {
        throw error;
      }

      setIsRequestSent(true);
      toast.success(
        "If an account exists with this email, you will receive password reset instructions."
      );
      form.reset();
    } catch (error) {
      console.error("Password reset error:", error);
      toast.error(
        "Unable to process your request at this time. Please try again later."
      );
    } finally {
      setIsLoading(false);
    }
  }

  if (isRequestSent) {
    return (
      <div className="space-y-4 text-center">
        <h2 className="text-lg font-semibold">Check Your Email</h2>
        <p className="text-muted-foreground">
          We've sent password reset instructions to your email address. Please
          check your inbox and spam folder.
        </p>
        <div className="space-y-2">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => setIsRequestSent(false)}
          >
            Try another email
          </Button>
          <Button
            type="button"
            variant="link"
            className="w-full"
            onClick={onBackToLogin}
          >
            Back to login
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Reset Password</h2>
          <p className="text-sm text-muted-foreground">
            Enter your email address and we'll send you instructions to reset
            your password.
          </p>
        </div>

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input
                  placeholder="name@example.com"
                  type="email"
                  disabled={isLoading}
                  {...field}
                />
              </FormControl>
              <FormDescription>
                We'll send a password reset link to this email address.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="space-y-2">
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? "Sending instructions..." : "Send reset instructions"}
          </Button>
          <Button
            type="button"
            variant="link"
            className="w-full"
            onClick={onBackToLogin}
          >
            Back to login
          </Button>
        </div>
      </form>
    </Form>
  );
}
