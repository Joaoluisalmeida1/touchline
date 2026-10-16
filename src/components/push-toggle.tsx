"use client";
import { Bell, BellOff, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { deletePushSubscriptionAction, savePushSubscriptionAction } from "@/server/actions";
import { Button } from "./ui";

const b64ToBytes = (b64: string) => {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
};

/** Opt-in web push on this device (results, offers, transfers). Hidden when the server has no VAPID key. */
export function PushToggle({ publicKey }: { publicKey: string }) {
  const [state, setState] = useState<"unsupported" | "off" | "on" | "denied" | "busy">("busy");
  const [msg, setMsg] = useState("");
  useEffect(() => {
    if (!publicKey || !("serviceWorker" in navigator) || !("PushManager" in window)) { setState("unsupported"); return; }
    if (Notification.permission === "denied") { setState("denied"); return; }
    navigator.serviceWorker.register("/sw.js").then((reg) => reg.pushManager.getSubscription()).then((s) => setState(s ? "on" : "off")).catch(() => setState("unsupported"));
  }, [publicKey]);

  if (!publicKey || state === "unsupported") return <p className="text-sm text-muted">Este browser não suporta notificações push{publicKey ? "" : " (ainda não configuradas no servidor)"}. No iPhone, adiciona o site ao ecrã principal primeiro.</p>;
  if (state === "denied") return <p className="text-sm text-warn">Bloqueaste as notificações para este site. Ativa-as nas definições do browser.</p>;

  const enable = async () => {
    setState("busy");
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
      const r = await savePushSubscriptionAction(sub.toJSON());
      setMsg(r.error ?? r.message ?? "");
      setState(r.error ? "off" : "on");
    } catch {
      setMsg("Não foi possível ativar. Aceita o pedido de permissão do browser.");
      setState("off");
    }
  };
  const disable = async () => {
    setState("busy");
    const reg = await navigator.serviceWorker.getRegistration("/sw.js");
    const sub = await reg?.pushManager.getSubscription();
    if (sub) { await deletePushSubscriptionAction(sub.endpoint); await sub.unsubscribe(); }
    setMsg("Notificações desativadas neste dispositivo.");
    setState("off");
  };
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">Recebe no telemóvel o resultado de cada jornada, propostas e transferências.</p>
      {state === "on" ? (
        <Button type="button" variant="secondary" onClick={disable}><BellOff className="size-4" />Desativar neste dispositivo</Button>
      ) : (
        <Button type="button" onClick={enable} disabled={state === "busy"}>{state === "busy" ? <LoaderCircle className="size-4 animate-spin" /> : <Bell className="size-4" />}Ativar notificações</Button>
      )}
      {msg && <p aria-live="polite" className="text-xs text-muted">{msg}</p>}
    </div>
  );
}
