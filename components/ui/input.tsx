import * as React from "react"

import { cn } from "@/lib/utils"

type InputSize = "sm" | "md"

interface InputProps extends Omit<React.ComponentProps<"input">, "size"> {
  size?: InputSize
}

const sizeClasses: Record<InputSize, string> = {
  sm: "h-8 text-sm px-2.5",
  md: "h-9 text-base px-3 md:text-sm",
}

function Input({ className, type, size = "md", ...props }: InputProps) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "w-full min-w-0 rounded-lg border border-input/80 bg-background/65 py-1 shadow-xs transition-[border-color,color,box-shadow,background-color] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground/80 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/35",
        sizeClasses[size],
        "focus-visible:border-ring focus-visible:bg-background focus-visible:ring-[3px] focus-visible:ring-ring/25",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
