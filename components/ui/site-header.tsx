import Link from "next/link";
import { getCurrentClient, logoutClientAction } from "@/lib/actions/client-auth-actions";

export async function SiteHeader() {
  const client = await getCurrentClient();

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Link href="/" className="text-lg font-black tracking-[0.2em] text-zinc-100">
          ALFA BARBER
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-zinc-300 sm:flex">
          <a href="#servicos" className="hover:text-cyan-300">Serviços</a>
          <a href="#equipe" className="hover:text-cyan-300">Equipe</a>
          <a href="#preços" className="hover:text-cyan-300">Preços</a>
          <a href="#faq" className="hover:text-cyan-300">FAQ</a>
        </nav>

        <div className="flex items-center gap-2">
          {client ? (
            <>
              <span className="hidden text-xs text-zinc-400 sm:block">Olá, {client.name.split(" ")[0]}</span>
              <form action={logoutClientAction}>
                <button
                  type="submit"
                  className="rounded-md border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-100 transition hover:border-zinc-500"
                >
                  Sair
                </button>
              </form>
            </>
          ) : (
            <Link
              href="/cliente/login?next=/agendar"
              className="rounded-md border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-100 transition hover:border-zinc-500"
            >
              Entrar
            </Link>
          )}
          <Link
            href="/agendar"
            className="rounded-md bg-cyan-400 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-300"
          >
            Agendar
          </Link>
        </div>
      </div>
    </header>
  );
}
