"use client";
import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/server/actions";
import { Button, cn } from "./ui";

type Action = (state: ActionState, form: FormData) => Promise<ActionState>;
type Variant = "primary" | "secondary" | "ghost" | "danger";

function Submit({ label, pendingLabel, variant, className, icon }: { label: ReactNode; pendingLabel?: string; variant?: Variant; className?: string; icon?: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending} aria-busy={pending} className={className}>
      {pending ? <LoaderCircle className="size-4 animate-spin" /> : icon}
      {pending ? pendingLabel ?? "A processar…" : label}
    </Button>
  );
}

/** Animated inline result line (success / error). */
export function FormMessage({ state, className }: { state: ActionState; className?: string }) {
  const text = state.error ?? state.message ?? "";
  return (
    <div aria-live="polite" className={cn("text-sm", className)}>
      <AnimatePresence mode="wait" initial={false}>
        {text && (
          <motion.p key={text} initial={{ opacity: 0, y: -4, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, y: 4 }}
            className={cn("flex items-start gap-1.5 font-medium", state.error ? "text-danger" : "text-accent")}>
            {state.error ? <CircleAlert className="mt-0.5 size-4 shrink-0" /> : <CircleCheck className="mt-0.5 size-4 shrink-0" />}
            <span>{text}</span>
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Progressive-enhancement form bound to a Server Action, with pending state and an aria-live result message. */
export function ActionForm({
  action, hidden = {}, submitLabel, pendingLabel, variant = "primary", children, className, inline, confirm, onSuccess, resetOnSuccess, icon, submitClassName,
}: {
  action: Action; hidden?: Record<string, string>; submitLabel: ReactNode; pendingLabel?: string;
  variant?: Variant; children?: ReactNode; className?: string; inline?: boolean;
  confirm?: string; onSuccess?: (s: ActionState) => void; resetOnSuccess?: boolean; icon?: ReactNode; submitClassName?: string;
}) {
  const [state, formAction] = useActionState(action, {} as ActionState);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) {
      onSuccess?.(state);
      if (resetOnSuccess) ref.current?.reset();
    }
  }, [state, onSuccess, resetOnSuccess]);
  return (
    <form
      ref={ref}
      action={formAction}
      className={cn(inline ? "flex flex-wrap items-end gap-2" : "space-y-4", className)}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {children}
      <Submit label={submitLabel} pendingLabel={pendingLabel} variant={variant} icon={icon} className={submitClassName} />
      <FormMessage state={state} className={cn(inline && "basis-full")} />
    </form>
  );
}
