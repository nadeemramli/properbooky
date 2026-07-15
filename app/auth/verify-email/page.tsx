import Link from "next/link";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function VerifyEmailPage() {
  return (
    <div className="container max-w-md mx-auto mt-8 p-6">
      <div className="space-y-6 text-center">
        <div className="flex justify-center">
          <div className="rounded-full bg-muted p-4">
            <MailCheck className="h-8 w-8 text-muted-foreground" />
          </div>
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">Check your email</h1>
          <p className="text-gray-500">
            We've sent you a confirmation link. Click it to activate your
            account, then sign in. If you don't see it, check your spam folder.
          </p>
        </div>
        <Button asChild className="w-full">
          <Link href="/auth">Back to sign in</Link>
        </Button>
      </div>
    </div>
  );
}
