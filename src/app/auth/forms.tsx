"use client";
import { useActionState, useState } from "react";
import { loginAction, signupAction, type ActionState } from "@/server/actions";
import { Button, Card, Field, inputCls, cn } from "@/components/ui";

export function AuthForms({ next, initialMode }: { next: string; initialMode: "login" | "signup" }) {
  const [mode, setMode] = useState(initialMode);
  const [loginState, login, loginPending] = useActionState(loginAction, {} as ActionState);
  const [signupState, signup, signupPending] = useActionState(signupAction, {} as ActionState);
  const state = mode === "login" ? loginState : signupState;
  return (
    <Card className="p-6">
      <div role="tablist" className="mb-6 grid grid-cols-2 rounded-lg bg-bg p-1 text-sm">
        {(["login", "signup"] as const).map((m) => (
          <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
            className={cn("rounded-md py-2 font-semibold", mode === m ? "bg-surface-2 text-ink" : "text-muted")}>
            {m === "login" ? "Entrar" : "Criar conta"}
          </button>
        ))}
      </div>
      <form action={mode === "login" ? login : signup} className="space-y-4">
        <input type="hidden" name="next" value={next} />
        {mode === "signup" && (
          <Field label="Nome de treinador">
            <input name="displayName" required minLength={2} maxLength={40} className={inputCls} autoComplete="nickname" />
          </Field>
        )}
        <Field label="Email">
          <input name="email" type="email" required className={inputCls} autoComplete="email" />
        </Field>
        <Field label="Palavra-passe" hint={mode === "signup" ? "Mínimo 8 caracteres." : undefined}>
          <input name="password" type="password" required minLength={8} className={inputCls} autoComplete={mode === "login" ? "current-password" : "new-password"} />
        </Field>
        <Button type="submit" className="w-full" disabled={loginPending || signupPending}>
          {loginPending || signupPending ? "Aguarda…" : mode === "login" ? "Entrar" : "Criar conta"}
        </Button>
        <p aria-live="polite" className={cn("text-sm", state.error ? "text-danger" : "text-accent")}>{state.error ?? state.message ?? ""}</p>
      </form>
    </Card>
  );
}
