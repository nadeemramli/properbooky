"use client";

import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";

import { cn } from "@/lib/utils";

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & {
    value?: number | null;
  }
>(({ className, value = 0, ...props }, ref) => {
  const [mounted, setMounted] = React.useState(false);
  const clampedValue = Math.min(Math.max(value ?? 0, 0), 100);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  // Use a simpler implementation for static export
  return (
    <div
      ref={ref}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clampedValue}
      className={cn(
        "relative h-4 w-full overflow-hidden rounded-full bg-secondary",
        className
      )}
      {...props}
    >
      <div
        className="h-full w-full flex-1 bg-primary transition-all"
        style={{
          transform: mounted
            ? `translateX(-${100 - clampedValue}%)`
            : "translateX(-100%)",
        }}
      />
    </div>
  );
});
Progress.displayName = "Progress";

export { Progress };
