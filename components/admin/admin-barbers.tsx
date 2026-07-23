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

  const save = (barber: Barber, isActive: boolean) =>
    startTransition(async () => {
      const result = await updateBarberAction({
        barberId: barber.id,
        name: drafts[barber.id] ?? barber.name,
        isActive,
      });
      pushToast(result.message, result.success ? "success" : "error");
      if (result.success) window.location.reload();
    });

  return (
    <section className="space-y-5">
      <header className="premium-card rounded-3xl p-5">
        <p className="eyebrow">Equipe</p>
        <h1 className="mt-2 text-3xl font-semibold">Barbeiros</h1>
        <p className="mt-2 text-sm text-copy-muted">Gerencie os profissionais que aparecem na agenda.</p>
      </header>

      <form action={formAction} className="premium-card flex flex-col gap-3 rounded-2xl p-5 sm:flex-row">
        <input
          name="name"
          required
          minLength={2}
          placeholder="Nome do barbeiro"
          aria-label="Nome do novo barbeiro"
          className="ui-control min-h-11 flex-1 px-3"
        />
        <button disabled={pendingCreate} className="button-primary">
          {pendingCreate ? "Adicionando..." : "Adicionar"}
        </button>
      </form>

      <div className="grid gap-3">
        {barbers.map((barber) => (
          <article key={barber.id} className="premium-card flex flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:items-center">
            <input
              value={drafts[barber.id] ?? ""}
              aria-label={`Nome de ${barber.name}`}
              onChange={(event) =>
                setDrafts((value) => ({ ...value, [barber.id]: event.target.value }))
              }
              className="ui-control min-h-11 flex-1 px-3"
            />
            <span
              className={
                barber.isActive
                  ? "w-fit rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-xs font-semibold text-success-soft"
                  : "w-fit rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-copy-muted"
              }
            >
              {barber.isActive ? "Ativo" : "Inativo"}
            </span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pending}
                className="button-secondary flex-1 sm:flex-none"
                onClick={() => save(barber, !barber.isActive)}
              >
                {barber.isActive ? "Desativar" : "Ativar"}
              </button>
              <button
                type="button"
                disabled={pending}
                className="button-primary flex-1 sm:flex-none"
                onClick={() => save(barber, barber.isActive)}
              >
                {pending ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
