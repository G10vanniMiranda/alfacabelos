import { listBarbers, listGalleryImages, listServices } from "@/lib/booking-service";
import { testimonials } from "@/lib/data/seed";
import { formatBRLFromCents } from "@/lib/utils";

export async function HomeSections() {
  const [services, barbers, galleryImages] = await Promise.all([listServices(), listBarbers(), listGalleryImages()]);

  return (
    <>
      <section id="servicos" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-3xl font-bold text-zinc-100">Servicos</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {services.map((service) => (
            <article key={service.id} className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-5">
              <h3 className="text-xl font-semibold text-zinc-100">{service.name}</h3>
              <p className="mt-2 text-cyan-300">{formatBRLFromCents(service.priceCents)}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="equipe" className="border-y border-zinc-800 bg-zinc-900/40 py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="text-3xl font-bold text-zinc-100">Equipe</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 md:grid-cols-3">
            {barbers.map((barber) => (
              <article key={barber.id} className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
                <p className="text-lg font-semibold text-zinc-100">{barber.name}</p>
                <p className="text-sm text-zinc-400">Especialista em cortes premium</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="depoimentos" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
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

      <section id="galeria" className="border-y border-zinc-800 bg-zinc-900/40 py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="text-3xl font-bold text-zinc-100">Galeria</h2>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {galleryImages.length > 0
              ? galleryImages.map((image) => (
                  <article key={image.id} className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
                    <img
                      src={image.imageUrl}
                      alt={image.altText ?? "Foto da galeria da barbearia"}
                      className="aspect-square w-full object-cover transition duration-300 hover:scale-105"
                      loading="lazy"
                    />
                  </article>
                ))
              : [1, 2, 3, 4].map((item) => (
                  <div
                    key={item}
                    className="aspect-square rounded-lg border border-zinc-800 bg-linear-to-br from-zinc-900 via-zinc-800 to-cyan-950"
                  />
                ))}
          </div>
        </div>
      </section>

      <section id="localizacao" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-3xl font-bold text-zinc-100">Localização</h2>
        <p className="mt-3 text-zinc-300">R. Sao Miguel, 824 - Eldorado, Porto Velho - RO, 76811-888</p>
        <div className="mt-6 aspect-video rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-sm text-zinc-500">
          <iframe
            src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d1623.087367220366!2d-63.871474024266924!3d-8.786385786098876!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x92325d64144e26bf%3A0xcb50b4b781eee0fe!2sAlfa%20-%20Para%20todos%20os%20cabelos*21!5e1!3m2!1spt-BR!2sbr!4v1770951104946!5m2!1spt-BR!2sbr"
            width="600"
            height="450"
            style={{ border: 0 }}
            allowFullScreen
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            className="h-full w-full rounded-md"
          >
          </iframe>
        </div>
      </section>

      <section id="faq" className="border-y border-zinc-800 bg-zinc-900/40 py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="max-w-3xl">
            <p className="text-xs uppercase tracking-[0.22em] text-cyan-300">Dúvidas frequentes</p>
            <h2 className="mt-3 text-3xl font-bold text-zinc-100">FAQ</h2>
            <p className="mt-3 text-sm text-zinc-400">
              Respostas objetivas sobre agendamento, atendimento e formas de pagamento.
            </p>
          </div>

          <div className="mt-8 grid gap-3">
            <details className="group rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 open:border-cyan-400/40 open:bg-cyan-500/5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-zinc-100">
                Posso reagendar meu horário?
                <span className="text-zinc-400 transition group-open:rotate-45 group-open:text-cyan-300">+</span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-zinc-300">
                Sim. O reagendamento pode ser feito pela equipe administrativa conforme disponibilidade na agenda.
              </p>
            </details>

            <details className="group rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 open:border-cyan-400/40 open:bg-cyan-500/5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-zinc-100">
                Vocês atendem por encaixe?
                <span className="text-zinc-400 transition group-open:rotate-45 group-open:text-cyan-300">+</span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-zinc-300">
                Atendemos encaixes quando há janela livre no dia. Para garantir horário, o ideal é agendar antecipadamente.
              </p>
            </details>

            <details className="group rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 open:border-cyan-400/40 open:bg-cyan-500/5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-zinc-100">
                Quais formas de pagamento são aceitas?
                <span className="text-zinc-400 transition group-open:rotate-45 group-open:text-cyan-300">+</span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-zinc-300">
                Aceitamos Pix, cartão de débito e cartão de crédito.
              </p>
            </details>
          </div>
        </div>
      </section>

      <footer className="mx-auto max-w-6xl px-4 py-8 text-sm text-zinc-500 sm:px-6">
        {new Date().getFullYear()} ALFA Barber. Todos os direitos reservados.
      </footer>
    </>
  );
}
