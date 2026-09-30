import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Tone } from "./tone";

/** A side panel (bottom sheet on phones). Radix Dialog underneath: same roles and focus trap. */
const Sheet = DialogPrimitive.Root;
const SheetClose = DialogPrimitive.Close;

const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { tone?: Tone }
>(({ className, children, tone = "idle", ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
    <DialogPrimitive.Content
      ref={ref}
      data-tone={tone}
      aria-describedby={undefined}
      className={cn(
        "fixed z-50 flex flex-col border-line bg-surface text-fg shadow-[var(--shadow-lg)] outline-none",
        "inset-x-0 bottom-0 h-[88vh] rounded-t-2xl border-t",
        "sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:w-[460px] sm:rounded-none sm:border-l sm:border-t-0",
        "data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom sm:data-[state=closed]:slide-out-to-right sm:data-[state=open]:slide-in-from-right",
        className,
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
SheetContent.displayName = "SheetContent";

function SheetHeader({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("relative flex items-center gap-3 border-b border-line px-5 py-4", className)} {...props}>
      <span aria-hidden className="absolute bottom-4 left-0 top-4 w-[3px] rounded-r bg-tone shadow-[0_0_12px_hsl(var(--c))]" />
      {children}
      <DialogPrimitive.Close className="ml-auto inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] text-fg-muted hover:bg-hover hover:text-fg">
        <X className="h-4 w-4" />
        <span className="sr-only">Закрыть</span>
      </DialogPrimitive.Close>
    </div>
  );
}

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn("font-display text-xl font-bold tracking-tight", className)} {...props} />
));
SheetTitle.displayName = "SheetTitle";

function SheetBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("grid flex-1 content-start gap-6 overflow-y-auto p-5", className)} {...props} />;
}

function SheetFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex gap-2 border-t border-line px-5 py-4 [&>*]:flex-1", className)} {...props} />;
}

export { Sheet, SheetBody, SheetClose, SheetContent, SheetFooter, SheetHeader, SheetTitle };
