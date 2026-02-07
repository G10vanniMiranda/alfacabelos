import { barbersSeed, servicesSeed, testimonials } from "@/lib/data/seed";
import { formatBRLFromCents } from "@/lib/utils";

export function HomeSections() {
  return (
    <>
      <section id="servicos" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-3xl font-bold text-zinc-100">Servicos</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {servicesSeed.map((service) => (
            <article key={service.id} className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-5">
              <h3 className="text-xl font-semibold text-zinc-100">{service.name}</h3>
              <p className="mt-2 text-zinc-400">Duracao: {service.durationMinutes} min</p>
              <p className="text-cyan-300">{formatBRLFromCents(service.priceCents)}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="equipe" className="border-y border-zinc-800 bg-zinc-900/40 py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="text-3xl font-bold text-zinc-100">Equipe</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 md:grid-cols-3">
            {barbersSeed.map((barber) => (
              <article key={barber.id} className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
                <p className="text-lg font-semibold text-zinc-100">{barber.name}</p>
                <p className="text-sm text-zinc-400">Especialista em cortes premium</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="precos" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-3xl font-bold text-zinc-100">Depoimentos</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {testimonials.map((item) => (
            <article key={item.name} className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-5">
              <p className="text-zinc-300">&ldquo;{item.text}&rdquo;</p>
              <p className="mt-3 text-sm font-semibold text-cyan-300">{item.name}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-zinc-800 bg-zinc-900/40 py-16">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 sm:px-6 md:grid-cols-2">
          <div>
            <h2 className="text-3xl font-bold text-zinc-100">Galeria</h2>
            <div className="mt-5 grid grid-cols-2 gap-3">
              {[1, 2, 3, 4].map((item) => (
                <div
                  key={item}
                  className="aspect-square rounded-lg border border-zinc-800 bg-gradient-to-br from-zinc-900 via-zinc-800 to-cyan-950"
                />
              ))}
            </div>
          </div>
          <div>
            <h2 className="text-3xl font-bold text-zinc-100">Localizacao</h2>
            <p className="mt-3 text-zinc-300">Rua Exemplo, 100 - Centro, Sao Paulo/SP</p>
            <div className="mt-4 aspect-video rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-sm text-zinc-500">
              Embed de mapa opcional
            </div>
            <h3 id="faq" className="mt-8 text-2xl font-bold text-zinc-100">FAQ</h3>
            <ul className="mt-3 space-y-2 text-sm text-zinc-300">
              <li>Posso reagendar? Sim, pela area admin.</li>
              <li>Tem encaixe sem horario? Depende da agenda do dia.</li>
              <li>Quais formas de pagamento? Pix, debito e credito.</li>
            </ul>
          </div>
        </div>
      </section>

      <footer className="mx-auto max-w-6xl px-4 py-8 text-sm text-zinc-500 sm:px-6">
         {new Date().getFullYear()} ALFA Barber. Todos os direitos reservados.
      </footer>
    </>
  );
}

