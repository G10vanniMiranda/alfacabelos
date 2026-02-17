"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { adminLogoutAction } from "@/lib/actions/booking-actions";

const items = [
  { href: "/admin/dashboard", label: "Dashboard" },
  { href: "/admin/servicos", label: "Serviços" },
  { href: "/admin/agenda", label: "Agenda" },
  { href: "/admin/bloqueios", label: "Bloqueios" },
  { href: "/admin/galeria", label: "Galeria" },
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
      <div className="rounded-xl border border-zinc-700/80 bg-zinc-950/80 p-4">
        <p className="text-xs uppercase tracking-[0.22em] text-cyan-300">ESPAÇO ALFA</p>
        <h1 className="mt-2 text-xl font-semibold text-zinc-100">Painel Admin</h1>
        <p className="mt-1 text-xs text-zinc-400">Gestão operacional</p>
      </div>

      <nav className="mt-4 space-y-2 text-sm">
        {items.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setIsMenuOpen(false)}
              className={`block rounded-lg border px-3 py-2 transition ${
                active
                  ? "border-cyan-400/70 bg-cyan-500/10 text-cyan-200"
                  : "border-zinc-700 bg-zinc-950/70 text-zinc-200 hover:border-cyan-400/50 hover:text-cyan-200"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <button
        type="button"
        onClick={logout}
        disabled={isPending}
        className="mt-4 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:border-zinc-500 disabled:opacity-60"
      >
        Sair
      </button>
    </>
  );

  return (
    <>
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-3 xl:hidden">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-700/80 bg-zinc-950/80 p-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-cyan-300">ESPAÇO ALFA</p>
            <p className="mt-1 text-sm font-semibold text-zinc-100">Painel Admin</p>
          </div>
          <button
            type="button"
            onClick={() => setIsMenuOpen(true)}
            aria-label="Abrir menu"
            className="rounded-lg border border-zinc-700 bg-zinc-900 p-2 text-zinc-100 transition hover:border-cyan-300"
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

      <aside className="hidden rounded-2xl border border-zinc-800 bg-zinc-900/80 p-4 xl:sticky xl:top-6 xl:block">
        {nav}
      </aside>
    </>
  );
}
