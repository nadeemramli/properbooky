"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import LoginForm from "./login-form";
import SignUpForm from "./signup-form";
import PasswordResetForm from "./password-reset-form";

type AuthMode = "login" | "signup" | "reset";

export default function AuthForm() {
  const [mode, setMode] = useState<AuthMode>("login");

  return (
    <Card>
      <Tabs
        value={mode}
        onValueChange={(value) => setMode(value as AuthMode)}
        className="w-full"
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="login">Login</TabsTrigger>
          <TabsTrigger value="signup">Sign Up</TabsTrigger>
        </TabsList>
        <CardContent className="p-6">
          <TabsContent value="login">
            <LoginForm onResetClick={() => setMode("reset")} />
          </TabsContent>
          <TabsContent value="signup">
            <SignUpForm />
          </TabsContent>
          <TabsContent value="reset">
            <PasswordResetForm onBackToLogin={() => setMode("login")} />
          </TabsContent>
        </CardContent>
        <CardFooter className="flex flex-col space-y-4">
          <div className="text-sm text-muted-foreground text-center">
            Protected by Supabase Auth. Read our{" "}
            <a
              href="#"
              className="underline underline-offset-4 hover:text-primary"
            >
              Privacy Policy
            </a>
          </div>
        </CardFooter>
      </Tabs>
    </Card>
  );
}
