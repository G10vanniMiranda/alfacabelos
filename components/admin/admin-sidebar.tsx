"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Icon, type IconName } from "@/components/ui/icon";
import { adminLogoutAction } from "@/lib/actions/booking-actions";

type NavigationItem = {
  href: string;
  label: string;
  icon: IconName;
};

const navigationGroups: Array<{ label: string; items: NavigationItem[] }> = [
  {
    label: "Operação",
    items: [
      { href: "/admin/dashboard", label: "Visão geral", icon: "dashboard" },
      { href: "/admin/agenda", label: "Agenda", icon: "agenda" },
      { href: "/admin/horarios", label: "Horários", icon: "clock" },
      { href: "/admin/bloqueios", label: "Bloqueios", icon: "block" },
    ],
  },
  {
    label: "Gestão",
    items: [
      { href: "/admin/barbeiros", label: "Barbeiros", icon: "barber" },
      { href: "/admin/servicos", label: "Serviços", icon: "scissors" },
      { href: "/admin/ganhos", label: "Financeiro", icon: "money" },
      { href: "/admin/galeria", label: "Galeria", icon: "gallery" },
      { href: "/admin/acessos", label: "Acessos", icon: "access" },
    ],
  },
];

function isActiveRoute(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminSidebar() {
  const pathname = usePathname();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileNavigationRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!isMenuOpen) return;
    const previousOverflow = document.body.style.overflow;
    const menuButton = menuButtonRef.current;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const handleDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = mobileNavigationRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", handleDialogKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleDialogKeyDown);
      menuButton?.focus();
    };
  }, [isMenuOpen]);

  function logout() {
    startTransition(async () => {
      await adminLogoutAction();
      window.location.href = "/admin";
    });
  }

  const navigation = (
    <>
      <div className="px-2 pb-5 pt-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-brand-highlight">ESPAÇO ALFA</p>
        <h1 className="mt-2 text-xl font-semibold text-zinc-100">Painel administrativo</h1>
        <p className="mt-1 text-xs text-copy-muted">Gestão da operação</p>
      </div>

      <nav aria-label="Navegação administrativa" className="space-y-5">
        {navigationGroups.map((group) => (
          <div key={group.label}>
            <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-copy-muted">
              {group.label}
            </p>
            <div className="space-y-1">
              {group.items.map((item) => {
                const active = isActiveRoute(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setIsMenuOpen(false)}
                    className={`group flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                      active
                        ? "bg-brand-highlight/11 text-brand-soft shadow-[inset_3px_0_0_var(--brand-strong)]"
                        : "text-zinc-400 hover:bg-white/[0.045] hover:text-zinc-100"
                    }`}
                  >
                    <Icon
                      name={item.icon}
                      className={`size-5 shrink-0 transition ${active ? "text-brand-highlight" : "text-zinc-500 group-hover:text-zinc-300"}`}
                    />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="mt-6 border-t border-white/[0.06] pt-4">
        <button
          type="button"
          onClick={logout}
          disabled={isPending}
          className="button-ghost w-full justify-start gap-3 px-3 text-zinc-400 hover:text-zinc-100"
        >
          <Icon name="logout" className="size-5" />
          {isPending ? "Saindo..." : "Sair"}
        </button>
      </div>
    </>
  );

  return (
    <>
      <div className="flex items-center justify-between gap-3 rounded-2xl bg-zinc-900/70 p-3 shadow-[0_12px_40px_rgba(0,0,0,0.16)] xl:hidden">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-brand-highlight">ESPAÇO ALFA</p>
          <p className="mt-1 truncate text-sm font-semibold text-zinc-100">Painel administrativo</p>
        </div>
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setIsMenuOpen(true)}
          aria-label="Abrir menu de navegação"
          aria-expanded={isMenuOpen}
          aria-controls="admin-mobile-navigation"
          className="button-secondary size-11 shrink-0 p-0"
        >
          <Icon name="menu" className="size-5" />
        </button>
      </div>

      {isMenuOpen ? (
        <div className="fixed inset-0 z-50 xl:hidden">
          <button
            type="button"
            aria-label="Fechar menu de navegação"
            onClick={() => setIsMenuOpen(false)}
            className="absolute inset-0 bg-zinc-950/80 backdrop-blur-sm"
          />
          <aside
            ref={mobileNavigationRef}
            id="admin-mobile-navigation"
            role="dialog"
            aria-modal="true"
            aria-label="Menu administrativo"
            className="absolute inset-y-0 right-0 w-[min(90vw,340px)] overflow-y-auto border-l border-white/[0.08] bg-zinc-950 p-4 shadow-2xl"
          >
            <div className="mb-2 flex justify-end">
              <button
                ref={closeButtonRef}
                type="button"
                aria-label="Fechar menu"
                onClick={() => setIsMenuOpen(false)}
                className="button-ghost size-11 p-0"
              >
                <Icon name="x" className="size-5" />
              </button>
            </div>
            {navigation}
          </aside>
        </div>
      ) : null}

      <aside className="hidden rounded-3xl bg-zinc-900/55 p-4 shadow-[0_18px_60px_rgba(0,0,0,0.2)] xl:sticky xl:top-6 xl:block">
        {navigation}
      </aside>
    </>
  );
}
