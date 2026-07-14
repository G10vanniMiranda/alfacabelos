"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { adminLogoutAction } from "@/lib/actions/booking-actions";

const items = [
  { href: "/admin/barbeiros", label: "Barbeiros", icon: "B" },
  { href: "/admin/dashboard", label: "Visão geral", icon: "⌂" },
  { href: "/admin/agenda", label: "Agenda", icon: "□" },
  { href: "/admin/horarios", label: "Horários", icon: "◷" },
  { href: "/admin/bloqueios", label: "Bloqueios", icon: "⊘" },
  { href: "/admin/servicos", label: "Serviços", icon: "◇" },
  { href: "/admin/ganhos", label: "Financeiro", icon: "$" },
  { href: "/admin/galeria", label: "Galeria", icon: "▧" },
  { href: "/admin/acessos", label: "Acessos", icon: "○" },
];

export function AdminSidebar() {
  const pathname = usePathname();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function logout() {
    startTransition(async () => {
      await adminLogoutAction();
      window.location.href = "/admin";
    });
  }

  const nav = (
    <>
      <div className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-amber-200">ESPAÇO ALFA</p>
        <h1 className="mt-2 text-xl font-semibold text-zinc-100">Operação</h1>
        <p className="mt-1 text-xs text-zinc-500">Gestão em tempo real</p>
      </div>

      <nav className="mt-4 space-y-2 text-sm">
        {items.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setIsMenuOpen(false)}
              className={`flex min-h-11 items-center gap-3 rounded-xl border px-3 py-2 transition ${
                active
                  ? "border-amber-200/40 bg-amber-200/10 text-amber-100"
                  : "border-transparent text-zinc-300 hover:border-white/10 hover:bg-white/[0.04] hover:text-white"
              }`}
            >
              <span aria-hidden="true" className="grid size-6 place-items-center text-zinc-500">{item.icon}</span>{item.label}
            </Link>
          );
        })}
      </nav>

      <button
        type="button"
        onClick={logout}
        disabled={isPending}
        className="button-secondary mt-4 w-full disabled:opacity-60"
      >
        Sair
      </button>
    </>
  );

  return (
    <>
      <div className="rounded-2xl border border-white/10 bg-zinc-900/80 p-2 xl:hidden">
        <div className="flex items-center justify-between gap-3 rounded-xl bg-zinc-950/80 p-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-amber-200">ESPAÇO ALFA</p>
            <p className="mt-1 text-sm font-semibold text-zinc-100">Painel de operação</p>
          </div>
          <button
            type="button"
            onClick={() => setIsMenuOpen(true)}
            aria-label="Abrir menu"
            className="grid size-11 place-items-center rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-100 transition hover:border-amber-200"
          >
            <span className="block h-0.5 w-5 bg-current" />
            <span className="mt-1.5 block h-0.5 w-5 bg-current" />
            <span className="mt-1.5 block h-0.5 w-5 bg-current" />
          </button>
        </div>
      </div>

      {isMenuOpen ? (
        <div className="fixed inset-0 z-50 xl:hidden">
          <button
            type="button"
            aria-label="Fechar menu"
            onClick={() => setIsMenuOpen(false)}
            className="absolute inset-0 bg-zinc-950/75 backdrop-blur-sm"
          />
          <aside className="absolute inset-y-0 right-0 w-[min(88vw,340px)] border-l border-zinc-800 bg-zinc-950 p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-zinc-200">Navegação</p>
              <button
                type="button"
                aria-label="Fechar menu"
                onClick={() => setIsMenuOpen(false)}
                className="rounded-md border border-zinc-700 px-2 py-1 text-sm text-zinc-200"
              >
                Fechar
              </button>
            </div>
            {nav}
          </aside>
        </div>
      ) : null}

      <aside className="premium-card hidden rounded-3xl p-4 xl:sticky xl:top-6 xl:block">
        {nav}
      </aside>
    </>
  );
}




