import Link from "next/link";
import { getCurrentClient, logoutClientAction } from "@/lib/actions/client-auth-actions";

const navigation = [
  { href: "/#servicos", label: "Serviços" },
  { href: "/#equipe", label: "Profissionais" },
  { href: "/#galeria", label: "Espaço" },
  { href: "/#localizacao", label: "Localização" },
];

function Brand() {
  return (
    <Link href="/" aria-label="Espaço Alfa — página inicial" className="group flex items-center gap-3">
      <span className="grid size-9 place-items-center rounded-full border border-amber-200/40 bg-amber-200/10 text-sm font-black text-amber-100 transition group-hover:bg-amber-200 group-hover:text-zinc-950">
        A
      </span>
      <span>
        <span className="block text-sm font-black tracking-[0.18em] text-stone-50">ESPAÇO ALFA</span>
        <span className="hidden text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500 sm:block">
          Para todos os cabelos
        </span>
      </span>
    </Link>
  );
}

export async function SiteHeader() {
  const client = await getCurrentClient();
  const firstName = client?.name.split(" ")[0];

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-[#080a0c]/88 backdrop-blur-xl">
      <div className="shell flex min-h-18 items-center justify-between gap-3 py-3">
        <Brand />

        <nav aria-label="Navegação principal" className="hidden items-center gap-7 lg:flex">
          {navigation.map((item) => (
            <Link key={item.href} href={item.href} className="text-sm font-medium text-stone-400 transition hover:text-amber-100">
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 sm:flex">
          {client ? (
            <>
              <Link href="/cliente" className="button-secondary">
                <span className="hidden md:inline">Olá, {firstName}</span>
                <span className="md:hidden">Minha área</span>
              </Link>
              <Link href="/agendar" className="button-primary">Agendar</Link>
            </>
          ) : (
            <>
              <Link href="/cliente/login?next=/cliente" className="button-ghost">Entrar</Link>
              <Link href="/cliente/cadastro" className="button-primary">Criar conta</Link>
            </>
          )}
        </div>

        <details className="group relative sm:hidden">
          <summary aria-label="Abrir menu" className="grid size-11 cursor-pointer list-none place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-stone-100">
            <span className="text-xl leading-none group-open:hidden">☰</span>
            <span className="hidden text-xl leading-none group-open:block">×</span>
          </summary>
          <div className="absolute right-0 top-14 w-[min(19rem,calc(100vw-1.5rem))] rounded-2xl border border-white/10 bg-[#111418] p-3 shadow-2xl">
            <nav aria-label="Navegação mobile" className="grid">
              {navigation.map((item) => (
                <Link key={item.href} href={item.href} className="rounded-xl px-3 py-3 text-sm font-semibold text-stone-200 hover:bg-white/5">
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="mt-2 grid gap-2 border-t border-white/10 pt-3">
              {client ? (
                <>
                  <Link href="/cliente" className="button-secondary">Minha área</Link>
                  <Link href="/agendar" className="button-primary">Novo agendamento</Link>
                  <form action={logoutClientAction}>
                    <button type="submit" className="button-ghost w-full">Sair da conta</button>
                  </form>
                </>
              ) : (
                <>
                  <Link href="/cliente/login?next=/cliente" className="button-secondary">Entrar</Link>
                  <Link href="/cliente/cadastro" className="button-primary">Criar conta</Link>
                </>
              )}
            </div>
          </div>
        </details>
      </div>
    </header>
  );
}
