"use client";

import { useActionState, useState, useTransition } from "react";
import type { Barber } from "@/types/domain";
import { createBarberAction, updateBarberAction } from "@/lib/actions/booking-actions";
import { useToast } from "@/components/ui/toast";

export function AdminBarbers({ barbers }: { barbers: Barber[] }) {
  const [, formAction, pendingCreate] = useActionState(createBarberAction, { success: false, message: "" });
  const [drafts, setDrafts] = useState(() => Object.fromEntries(barbers.map((barber) => [barber.id, barber.name])));
  const [pending, startTransition] = useTransition();
  const { pushToast } = useToast();
  const save = (barber: Barber, isActive: boolean) => startTransition(async () => {
    const result = await updateBarberAction({ barberId: barber.id, name: drafts[barber.id] ?? barber.name, isActive });
    pushToast(result.message, result.success ? "success" : "error");
    if (result.success) window.location.reload();
  });
  return <section className="space-y-5"><header className="premium-card rounded-3xl p-5"><p className="eyebrow">Equipe</p><h1 className="mt-2 text-3xl font-semibold">Barbeiros</h1></header><form action={formAction} className="premium-card flex flex-col gap-3 rounded-2xl p-5 sm:flex-row"><input name="name" required minLength={2} placeholder="Nome do barbeiro" className="min-h-11 flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-3"/><button disabled={pendingCreate} className="button-primary">Adicionar</button></form><div className="grid gap-3">{barbers.map((barber) => <article key={barber.id} className="premium-card flex flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:items-center"><input value={drafts[barber.id] ?? ""} onChange={(event) => setDrafts((value) => ({ ...value, [barber.id]: event.target.value }))} className="min-h-11 flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-3"/><span className={barber.isActive ? "text-emerald-300" : "text-zinc-500"}>{barber.isActive ? "Ativo" : "Inativo"}</span><button type="button" disabled={pending} className="button-secondary" onClick={() => save(barber, !barber.isActive)}>{barber.isActive ? "Desativar" : "Ativar"}</button><button type="button" disabled={pending} className="button-secondary" onClick={() => save(barber, barber.isActive)}>Salvar</button></article>)}</div></section>;
}
