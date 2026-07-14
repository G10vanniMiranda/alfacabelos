"use client";

import Link from "next/link";
import { useTransition } from "react";
import { adminLogoutAction } from "@/lib/actions/booking-actions";

export function BarberSidebar({ name }: { name: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <aside className="premium-card rounded-3xl p-4 xl:sticky xl:top-6">
      <p className="text-xs font-bold uppercase tracking-[0.22em] text-amber-200">Espaco Alfa</p>
      <h1 className="mt-2 text-xl font-semibold text-zinc-100">Agenda de {name}</h1>
      <p className="mt-1 text-xs text-zinc-500">Somente seus atendimentos e bloqueios.</p>
      <nav className="mt-5 space-y-2 text-sm">
        <Link className="flex min-h-11 items-center rounded-xl border border-amber-200/40 bg-amber-200/10 px-3 text-amber-100" href="/barbeiro/agenda">Agenda</Link>
        <Link className="flex min-h-11 items-center rounded-xl px-3 text-zinc-300 hover:bg-white/5" href="/barbeiro/bloqueios">Bloqueios</Link>
      </nav>
      <button type="button" disabled={pending} className="button-secondary mt-4 w-full" onClick={() => startTransition(async () => { await adminLogoutAction(); window.location.href = "/admin"; })}>Sair</button>
    </aside>
  );
}
