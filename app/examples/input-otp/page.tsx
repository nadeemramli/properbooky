"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  InputOTPSeparator,
  type InputOTPRenderProps,
} from "@/components/ui/input-otp";
import { toast } from "sonner";

export default function InputOTPDemo() {
  const [value, setValue] = React.useState("");

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    toast.success("OTP verified successfully!", {
      description: `You entered: ${value}`,
    });
  };

  const renderInput = React.useCallback(
    (props: InputOTPRenderProps) => (
      <InputOTPGroup>
        {props.slots.map((slot, index) => (
          <React.Fragment key={index}>
            <InputOTPSlot {...slot} index={index} />
            {index !== props.slots.length - 1 && <InputOTPSeparator />}
          </React.Fragment>
        ))}
      </InputOTPGroup>
    ),
    []
  );

  return (
    <div className="flex min-h-screen flex-col items-center justify-center space-y-8 p-8">
      <div className="w-full max-w-md space-y-4 text-center">
        <h1 className="text-3xl font-bold">Verify Your Account</h1>
        <p className="text-muted-foreground">
          Please enter the verification code sent to your device.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="w-full max-w-md space-y-4">
        <InputOTP
          value={value}
          onChange={setValue}
          maxLength={6}
          render={renderInput}
        />
        <Button type="submit" className="w-full" disabled={value.length < 6}>
          Verify Code
        </Button>
      </form>
      <p className="text-sm text-muted-foreground">
        Didn't receive a code?{" "}
        <Button variant="link" className="px-2 py-0">
          Resend
        </Button>
      </p>
    </div>
  );
}
