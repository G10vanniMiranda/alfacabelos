import Link from "next/link";
import { getCurrentClient, logoutClientAction } from "@/lib/actions/client-auth-actions";

export async function SiteHeader() {
  const client = await getCurrentClient();

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-4 sm:px-6">
        <Link href="/" className="text-sm font-black tracking-[0.14em] text-zinc-100 sm:text-lg sm:tracking-[0.2em]">
          ESPACO ALFA
        </Link>

        <nav className="hidden items-center gap-4 text-xs text-zinc-300 lg:flex xl:text-sm">
          <Link href="/#servicos" className="hover:text-cyan-300">Serviços</Link>
          <Link href="/#equipe" className="hover:text-cyan-300">Equipe</Link>
          <Link href="/#depoimentos" className="hover:text-cyan-300">Depoimentos</Link>
          <Link href="/#galeria" className="hover:text-cyan-300">Galeria</Link>
          <Link href="/#localizacao" className="hover:text-cyan-300">Localização</Link>
          <Link href="/#faq" className="hover:text-cyan-300">FAQ</Link>
        </nav>

        <div className="flex items-center gap-2">
          {client ? (
            <>
              <span className="hidden text-xs text-zinc-400 sm:block">Olá, {client.name.split(" ")[0]}</span>
              <Link
                href="/cliente"
                className="rounded-md border border-zinc-700 px-2.5 py-2 text-xs font-semibold text-zinc-100 transition hover:border-zinc-500 sm:px-3 sm:text-sm"
              >
                Minha área
              </Link>
              <form action={logoutClientAction}>
                <button
                  type="submit"
                  className="rounded-md border border-zinc-700 px-2.5 py-2 text-xs font-semibold text-zinc-100 transition hover:border-zinc-500 sm:px-3 sm:text-sm"
                >
                  Sair
                </button>
              </form>
            </>
          ) : (
            <Link
              href="/cliente/login?next=/cliente"
              className="rounded-md border border-zinc-700 px-2.5 py-2 text-xs font-semibold text-zinc-100 transition hover:border-zinc-500 sm:px-3 sm:text-sm"
            >
              Entrar
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
