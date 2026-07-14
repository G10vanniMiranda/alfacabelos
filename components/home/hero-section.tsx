import Link from "next/link";
import { getCurrentClient } from "@/lib/actions/client-auth-actions";

export async function HeroSection() {
  const client = await getCurrentClient();

  return (
    <section className="relative isolate overflow-hidden border-b border-white/[0.07]">
      <div className="absolute inset-0 -z-20 bg-[linear-gradient(110deg,#080a0c_15%,rgba(8,10,12,.84)_55%,rgba(8,10,12,.55))]" />
      <div className="absolute -right-24 top-10 -z-10 h-96 w-96 rounded-full bg-amber-200/[0.08] blur-3xl" />
      <div className="shell grid min-h-[calc(100svh-4.5rem)] items-center gap-12 py-16 lg:grid-cols-[1.08fr_.92fr] lg:py-24">
        <div className="max-w-3xl animate-fade-up">
          <p className="eyebrow">Barbearia • Porto Velho</p>
          <h1 className="mt-5 text-[clamp(3.15rem,8vw,6.7rem)] font-semibold leading-[0.9] text-stone-50">
            Seu estilo,
            <span className="block font-normal italic text-amber-200">do seu jeito.</span>
          </h1>
          <p className="mt-7 max-w-xl text-base leading-7 text-stone-400 sm:text-lg">
            Técnica, cuidado e uma experiência feita para você. Escolha o serviço, o profissional e o melhor horário — sem ligações.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link href={client ? "/agendar" : "/cliente/login?next=/agendar"} className="button-primary px-6 py-3.5">
              Escolher meu horário <span aria-hidden="true">→</span>
            </Link>
            <Link href="/#servicos" className="button-secondary px-6 py-3.5">Conhecer serviços</Link>
          </div>
          <ul className="mt-9 flex flex-wrap gap-x-6 gap-y-3 text-xs font-semibold uppercase tracking-[0.11em] text-stone-500" aria-label="Diferenciais">
            <li className="flex items-center gap-2"><span className="text-amber-200">✓</span> Horários em tempo real</li>
            <li className="flex items-center gap-2"><span className="text-amber-200">✓</span> Confirmação rápida</li>
            <li className="flex items-center gap-2"><span className="text-amber-200">✓</span> Atendimento personalizado</li>
          </ul>
        </div>

        <aside className="premium-card relative overflow-hidden rounded-[2rem] p-6 sm:p-8" aria-label="Informações de atendimento">
          <div className="absolute right-0 top-0 h-40 w-40 rounded-full bg-amber-200/[0.07] blur-3xl" />
          <div className="relative">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="eyebrow">Atendimento</p>
                <h2 className="mt-2 text-2xl font-semibold text-stone-100">Sua próxima pausa começa aqui.</h2>
              </div>
              <span className="grid size-12 shrink-0 place-items-center rounded-full border border-amber-200/25 bg-amber-200/10 text-xl" aria-hidden="true">✦</span>
            </div>
            <dl className="mt-8 divide-y divide-white/[0.08] border-y border-white/[0.08]">
              <div className="flex justify-between gap-4 py-4">
                <dt className="text-sm text-stone-500">Terça a sábado</dt>
                <dd className="text-right text-sm font-semibold text-stone-200">09h–12h • 14h–19h</dd>
              </div>
              <div className="flex justify-between gap-4 py-4">
                <dt className="text-sm text-stone-500">Agendamento</dt>
                <dd className="text-right text-sm font-semibold text-stone-200">Online, em poucos minutos</dd>
              </div>
              <div className="flex justify-between gap-4 py-4">
                <dt className="text-sm text-stone-500">Local</dt>
                <dd className="text-right text-sm font-semibold text-stone-200">Bairro Eldorado</dd>
              </div>
            </dl>
            <p className="mt-6 text-sm leading-6 text-stone-500">Você acompanha tudo pela sua área: confirmação, contato e histórico.</p>
          </div>
        </aside>
      </div>
    </section>
  );
}
