"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTransition } from "react";
import { adminLogoutAction } from "@/lib/actions/booking-actions";

const navigation = [
  { href: "/barbeiro/agenda", label: "Agenda" },
  { href: "/barbeiro/bloqueios", label: "Bloqueios" },
];

export function BarberSidebar({ name }: { name: string }) {
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  return (
    <aside className="premium-card rounded-3xl p-4 xl:sticky xl:top-6">
      <p className="text-xs font-bold uppercase tracking-[0.22em] text-brand-highlight">Espaço Alfa</p>
      <h1 className="mt-2 text-xl font-semibold text-zinc-100">Agenda de {name}</h1>
      <p className="mt-1 text-xs text-copy-muted">Somente seus atendimentos e bloqueios.</p>

      <nav className="mt-5 grid grid-cols-2 gap-2 text-sm xl:grid-cols-1" aria-label="Painel do barbeiro">
        {navigation.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={
                isActive
                  ? "flex min-h-11 items-center rounded-xl border border-brand-highlight/40 bg-brand-highlight/10 px-3 font-semibold text-brand-soft"
                  : "flex min-h-11 items-center rounded-xl border border-transparent px-3 text-zinc-300 transition hover:border-white/10 hover:bg-white/5 hover:text-white"
              }
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <button
        type="button"
        disabled={pending}
        className="button-secondary mt-4 w-full"
        onClick={() =>
          startTransition(async () => {
            await adminLogoutAction();
            window.location.href = "/admin";
          })
        }
      >
        {pending ? "Saindo..." : "Sair"}
      </button>
    </aside>
  );
}
