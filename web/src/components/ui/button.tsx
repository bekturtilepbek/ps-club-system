import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-fg bg-fg font-semibold text-ink hover:opacity-90",
        destructive: "border-status-circle bg-status-circle font-semibold text-ink hover:opacity-90",
        outline: "border-line bg-surface-2 text-fg hover:border-hover-line hover:bg-hover",
        secondary: "border-line bg-surface-2 text-fg hover:bg-hover",
        ghost: "border-transparent bg-transparent text-fg-muted hover:bg-surface hover:text-fg",
        link: "border-transparent text-fg underline-offset-4 hover:underline",
        // The primary action wears its card's colour: set data-tone on the button or an ancestor.
        state: "border-tone bg-tone font-semibold text-on-tone hover:brightness-110",
      },
      size: {
        default: "h-10 px-3.5",
        sm: "h-9 px-3",
        lg: "h-12 rounded-xl px-5 text-[15px]",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
