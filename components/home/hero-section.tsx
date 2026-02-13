import Link from "next/link";
import { getCurrentClient } from "@/lib/actions/client-auth-actions";

export async function HeroSection() {
  const client = await getCurrentClient();

  return (
    <section className="relative overflow-hidden border-b border-zinc-800">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,#155e75_0%,#0f172a_40%,#020617_100%)] opacity-60" />
      <div className="relative mx-auto grid max-w-6xl gap-8 px-4 py-20 sm:px-6 md:grid-cols-[1.2fr_1fr] md:py-28">
        <div>
          <p className="text-sm uppercase tracking-[0.28em] text-cyan-300">Barbearia premium</p>
          <h1 className="mt-4 text-4xl font-black leading-tight text-zinc-50 sm:text-5xl">
            Seu estilo começa
            <span className="text-cyan-300"> na cadeira certa.</span>
          </h1>
          <p className="mt-5 max-w-xl text-zinc-300">
            Cortes modernos, acabamento impecável e agendamento online em 4 passos.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {client ? (
              <Link
                href="/agendar"
                className="rounded-lg bg-cyan-400 px-6 py-3 text-sm font-bold text-zinc-950 transition hover:bg-cyan-300"
              >
                Agendar agora
              </Link>
            ) : null}
            <a
              href="#precos"
              className="rounded-lg border border-zinc-600 px-6 py-3 text-sm font-semibold text-zinc-100 hover:border-cyan-300"
            >
              Ver preços
            </a>
          </div>
        </div>
        <div className="rounded-2xl border border-cyan-500/40 bg-zinc-900/70 p-6 shadow-[0_0_60px_rgba(6,182,212,0.15)]">
          <p className="text-sm text-zinc-300">Hoje na ALFA</p>
          <ul className="mt-4 space-y-3 text-sm text-zinc-200">
            <li className="rounded-lg bg-zinc-800/60 px-3 py-2">Atendimento de segunda a sábado, 09h às 12h e 14h às 19h</li>
            <li className="rounded-lg bg-zinc-800/60 px-3 py-2">Confirmação em segundos</li>
            <li className="rounded-lg bg-zinc-800/60 px-3 py-2">Barbeiros especializados em cortes clássicos e modernos</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
