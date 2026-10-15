"use client";
import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/server/actions";
import { Button, cn } from "./ui";

type Action = (state: ActionState, form: FormData) => Promise<ActionState>;

function Submit({ label, pendingLabel, variant, className }: { label: ReactNode; pendingLabel?: string; variant?: "primary" | "secondary" | "ghost" | "danger"; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending} aria-busy={pending} className={className}>
      {pending ? pendingLabel ?? "A processar…" : label}
    </Button>
  );
}

/** Progressive-enhancement form bound to a Server Action, with pending state and an aria-live result message. */
export function ActionForm({
  action, hidden = {}, submitLabel, pendingLabel, variant = "primary", children, className, inline, confirm, onSuccess, resetOnSuccess,
}: {
  action: Action; hidden?: Record<string, string>; submitLabel: ReactNode; pendingLabel?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger"; children?: ReactNode; className?: string; inline?: boolean;
  confirm?: string; onSuccess?: (s: ActionState) => void; resetOnSuccess?: boolean;
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
      className={cn(inline ? "flex flex-wrap items-end gap-2" : "space-y-3", className)}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {children}
      <Submit label={submitLabel} pendingLabel={pendingLabel} variant={variant} />
      <p aria-live="polite" className={cn("text-sm", inline && "basis-full", state.error ? "text-danger" : "text-accent")}>
        {state.error ?? state.message ?? ""}
      </p>
    </form>
  );
}
