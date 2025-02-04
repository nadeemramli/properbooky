"use client";

import * as React from "react";
import { OTPInput } from "input-otp";
import type { OTPInputProps } from "input-otp";
import { MinusIcon } from "@radix-ui/react-icons";
import { cn } from "@/lib/utils";

interface SlotProps {
  char: string | null;
  hasFakeCaret: boolean;
  isActive: boolean;
}

// Define render props type
export interface InputOTPRenderProps {
  slots: SlotProps[];
}

interface InputOTPContextValue {
  slots: SlotProps[];
  containerRef: React.RefObject<HTMLDivElement>;
  handleKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  handleFocus: () => void;
  handleClick: () => void;
}

const InputOTPContext = React.createContext<InputOTPContextValue | null>(null);

function useInputOTPContext() {
  const context = React.useContext(InputOTPContext);
  if (!context) {
    throw new Error("useInputOTPContext must be used within an InputOTP");
  }
  return context;
}

type BaseInputOTPProps = Omit<OTPInputProps, "children" | "render" | "ref">;

interface InputOTPProps extends BaseInputOTPProps {
  /** The maximum length of the OTP input */
  maxLength: number;
  /** Additional className for the container */
  containerClassName?: string;
  /** Additional className for the input */
  className?: string;
  /** Render function to customize the OTP input */
  render: (props: InputOTPRenderProps) => React.ReactNode;
}

const InputOTP = React.forwardRef<
  React.ElementRef<typeof OTPInput>,
  InputOTPProps
>(({ className, containerClassName, maxLength = 6, render, ...props }, ref) => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [slots, setSlots] = React.useState<SlotProps[]>(
    Array(maxLength).fill({ char: null, hasFakeCaret: false, isActive: false })
  );

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // Handle keydown logic
    },
    []
  );

  const handleFocus = React.useCallback(() => {
    // Handle focus logic
  }, []);

  const handleClick = React.useCallback(() => {
    // Handle click logic
  }, []);

  return (
    <InputOTPContext.Provider
      value={{
        slots,
        containerRef,
        handleKeyDown,
        handleFocus,
        handleClick,
      }}
    >
      <OTPInput
        ref={ref}
        maxLength={maxLength}
        containerClassName={cn(
          "flex items-center gap-2 has-[:disabled]:opacity-50",
          containerClassName
        )}
        className={cn("disabled:cursor-not-allowed", className)}
        render={render}
        {...props}
      />
    </InputOTPContext.Provider>
  );
});
InputOTP.displayName = "InputOTP";

interface InputOTPGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Additional className for the group container */
  className?: string;
}

const InputOTPGroup = React.forwardRef<HTMLDivElement, InputOTPGroupProps>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center", className)} {...props} />
  )
);
InputOTPGroup.displayName = "InputOTPGroup";

interface InputOTPSlotProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The index of the slot */
  index: number;
  /** Additional className for the slot */
  className?: string;
}

const InputOTPSlot = React.forwardRef<HTMLDivElement, InputOTPSlotProps>(
  ({ index, className, ...props }, ref) => {
    const { slots, handleKeyDown, handleFocus, handleClick } =
      useInputOTPContext();
    const { char, hasFakeCaret, isActive } = slots[index] || {
      char: null,
      hasFakeCaret: false,
      isActive: false,
    };

    return (
      <div
        ref={ref}
        className={cn(
          "relative flex h-10 w-10 items-center justify-center border-y border-r border-input text-sm transition-all first:rounded-l-md first:border-l last:rounded-r-md",
          isActive && "z-10 ring-2 ring-ring ring-offset-background",
          className
        )}
        {...props}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onClick={handleClick}
        tabIndex={0}
      >
        {char}
        {hasFakeCaret && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-4 w-px animate-caret bg-foreground duration-500" />
          </div>
        )}
      </div>
    );
  }
);
InputOTPSlot.displayName = "InputOTPSlot";

interface InputOTPSeparatorProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Additional className for the separator */
  className?: string;
}

const InputOTPSeparator = React.forwardRef<
  HTMLDivElement,
  InputOTPSeparatorProps
>(({ className, ...props }, ref) => (
  <div ref={ref} role="separator" className={className} {...props}>
    <MinusIcon className="h-4 w-4" />
  </div>
));
InputOTPSeparator.displayName = "InputOTPSeparator";

export { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator };
