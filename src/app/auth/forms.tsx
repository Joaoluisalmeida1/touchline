"use client";
import { LoaderCircle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useActionState, useState } from "react";
import { loginAction, signupAction, type ActionState } from "@/server/actions";
import { FormMessage } from "@/components/action-form";
import { PillTabs } from "@/components/fx/tabs";
import { Button, Card, Field, inputCls } from "@/components/ui";

export function AuthForms({ next, initialMode }: { next: string; initialMode: "login" | "signup" }) {
  const [mode, setMode] = useState(initialMode);
  const [loginState, login, loginPending] = useActionState(loginAction, {} as ActionState);
  const [signupState, signup, signupPending] = useActionState(signupAction, {} as ActionState);
  const state = mode === "login" ? loginState : signupState;
  const pending = loginPending || signupPending;
  return (
    <Card className="p-6 sm:p-7">
      <p className="eyebrow">{mode === "login" ? "Bem-vindo de volta" : "Começa a tua carreira"}</p>
      <h2 className="headline mt-2 text-4xl">{mode === "login" ? "Entra no balneário" : "Novo treinador"}</h2>
      <PillTabs label="Modo" stretch className="mt-6" value={mode} onChange={setMode}
        tabs={[{ id: "login", label: "Entrar" }, { id: "signup", label: "Criar conta" }]} />
      <form action={mode === "login" ? login : signup} className="mt-6 space-y-4">
        <input type="hidden" name="next" value={next} />
        <AnimatePresence initial={false}>
          {mode === "signup" && (
            <motion.div key="name" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <Field label="Nome de treinador">
                <input name="displayName" required minLength={2} maxLength={40} className={inputCls} autoComplete="nickname" placeholder="Ex.: Mister Joao" />
              </Field>
            </motion.div>
          )}
        </AnimatePresence>
        <Field label="Email">
          <input name="email" type="email" required className={inputCls} autoComplete="email" placeholder="nome@exemplo.pt" />
        </Field>
        <Field label="Palavra-passe" hint={mode === "signup" ? "Mínimo 8 caracteres." : undefined}>
          <input name="password" type="password" required minLength={8} className={inputCls} autoComplete={mode === "login" ? "current-password" : "new-password"} />
        </Field>
        <Button type="submit" className="min-h-12 w-full text-base" disabled={pending}>
          {pending && <LoaderCircle className="size-4 animate-spin" />}
          {pending ? "Aguarda…" : mode === "login" ? "Entrar" : "Criar conta"}
        </Button>
        <FormMessage state={state} />
      </form>
    </Card>
  );
}
