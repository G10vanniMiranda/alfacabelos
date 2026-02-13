"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTransition } from "react";
import { adminLogoutAction } from "@/lib/actions/booking-actions";

const items = [
  { href: "/admin/servicos", label: "Servicos" },
  { href: "/admin/agenda", label: "Agenda" },
  { href: "/admin/bloqueios", label: "Bloqueios" },
];

export function AdminSidebar() {
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  return (
    <aside className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-4 lg:sticky lg:top-6">
      <div className="rounded-xl border border-zinc-700/80 bg-zinc-950/80 p-4">
        <p className="text-xs uppercase tracking-[0.22em] text-cyan-300">ALFA BARBER</p>
        <h1 className="mt-2 text-xl font-semibold text-zinc-100">Painel Admin</h1>
        <p className="mt-1 text-xs text-zinc-400">Gestao operacional</p>
      </div>

      <nav className="mt-4 space-y-2 text-sm">
        {items.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
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
        onClick={() => {
          startTransition(async () => {
            await adminLogoutAction();
            window.location.href = "/admin";
          });
        }}
        disabled={isPending}
        className="mt-4 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:border-zinc-500 disabled:opacity-60"
      >
        Sair
      </button>
    </aside>
  );
}
