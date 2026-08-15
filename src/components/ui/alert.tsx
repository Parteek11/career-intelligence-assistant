import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const alertVariants = cva(
  "flex items-start gap-2 rounded-md border px-3 py-2 text-sm [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:translate-y-0.5",
  {
    variants: {
      variant: {
        default: "border-border bg-background text-foreground",
        destructive: "border-destructive/30 bg-destructive/10 text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export type AlertProps = React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>;

export function Alert({ className, variant, role = "alert", ...props }: AlertProps) {
  return <div role={role} className={cn(alertVariants({ variant, className }))} {...props} />;
}
