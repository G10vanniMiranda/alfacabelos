import Link from "next/link";
import { listBarbers, listGalleryImages, listServices } from "@/lib/booking-service";
import { testimonials } from "@/lib/data/seed";
import { formatBRLFromCents } from "@/lib/utils";
import { GalleryCarousel } from "@/components/home/gallery-carousel";

function SectionHeading({ eyebrow, title, copy }: { eyebrow: string; title: string; copy?: string }) {
  return (
    <div className="max-w-2xl">
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-semibold text-stone-100 sm:text-5xl">{title}</h2>
      {copy ? <p className="mt-4 leading-7 text-stone-400">{copy}</p> : null}
    </div>
  );
}

export async function HomeSections() {
  const [servicesResult, barbersResult, galleryResult] = await Promise.allSettled([
    listServices(),
    listBarbers(),
    listGalleryImages(),
  ]);
  const services = servicesResult.status === "fulfilled" ? servicesResult.value : [];
  const barbers = barbersResult.status === "fulfilled" ? barbersResult.value : [];
  const galleryImages = galleryResult.status === "fulfilled" ? galleryResult.value : [];
  const dataUnavailable = [servicesResult, barbersResult, galleryResult].some((result) => result.status === "rejected");

  return (
    <>
      {dataUnavailable ? (
        <div role="alert" className="border-b border-amber-300/20 bg-amber-200/10 px-4 py-3 text-center text-sm text-amber-100">
          Alguns dados estão temporariamente indisponíveis. Tente novamente em instantes ou fale com nossa equipe.
        </div>
      ) : null}
      <section id="servicos" className="shell py-20 sm:py-28">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <SectionHeading eyebrow="Serviços" title="Cuidado sem excessos. Resultado com presença." copy="Cada atendimento respeita seu estilo, seu cabelo e o tempo que você tem." />
          <Link href="/agendar" className="button-secondary shrink-0">Ver horários disponíveis</Link>
        </div>

        {services.length ? (
          <div className="mt-10 grid gap-3 md:grid-cols-2">
            {services.map((service, index) => (
              <article key={service.id} className="group premium-card flex w-full min-w-0 items-center gap-3 overflow-hidden rounded-2xl p-5 transition hover:border-amber-200/30 sm:gap-4 sm:p-6">
                <span className="grid size-11 shrink-0 place-items-center rounded-full border border-white/10 text-xs font-bold text-stone-500 group-hover:border-amber-200/30 group-hover:text-amber-200">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="break-words text-lg font-semibold text-stone-100">{service.name}</h3>
                  <p className="mt-1 text-sm text-stone-500">{service.durationMinutes} minutos de atendimento</p>
                </div>
                <p className="shrink-0 text-base font-bold text-amber-200">{formatBRLFromCents(service.priceCents)}</p>
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-10 rounded-2xl border border-dashed border-white/15 p-6 text-sm text-stone-400">
            O catálogo está sendo atualizado. Entre em contato para consultar os serviços disponíveis.
          </div>
        )}
      </section>

      <section id="equipe" className="border-y border-white/[0.07] bg-white/[0.018] py-20 sm:py-28">
        <div className="shell">
          <SectionHeading eyebrow="Profissionais" title="Confiança começa em boas mãos." copy="Conheça quem vai cuidar de cada detalhe do seu visual." />
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {barbers.length ? barbers.map((barber) => (
              <article key={barber.id} className="premium-card relative min-h-56 overflow-hidden rounded-3xl p-6">
                <div className="absolute -bottom-16 -right-12 size-52 rounded-full border border-amber-200/10 bg-amber-200/[0.04]" />
                <span className="grid size-12 place-items-center rounded-full bg-amber-200 text-lg font-black text-zinc-950" aria-hidden="true">
                  {barber.name.charAt(0).toUpperCase()}
                </span>
                <div className="absolute bottom-6 left-6 right-6">
                  <h3 className="text-xl font-semibold text-stone-100">{barber.name}</h3>
                  <p className="mt-1 text-sm text-stone-500">Cortes clássicos e contemporâneos</p>
                </div>
              </article>
            )) : (
              <p className="text-sm text-stone-400">Os profissionais serão exibidos em breve.</p>
            )}
          </div>
        </div>
      </section>

      <section id="depoimentos" className="shell py-20 sm:py-28">
        <SectionHeading eyebrow="Experiência" title="Quem vem, recomenda." />
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {testimonials.map((item) => (
            <figure key={item.name} className="premium-card rounded-2xl p-6">
              <div className="text-sm tracking-[0.22em] text-amber-200" aria-label="5 estrelas">★★★★★</div>
              <blockquote className="mt-5 leading-7 text-stone-300">“{item.text}”</blockquote>
              <figcaption className="mt-6 text-sm font-semibold text-stone-100">{item.name}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      {galleryImages.length ? (
        <section id="galeria" className="border-y border-white/[0.07] bg-white/[0.018] py-20 sm:py-28">
          <div className="shell">
            <SectionHeading eyebrow="Nosso espaço" title="Feito para você se sentir em casa." />
            <div className="mt-8 overflow-hidden rounded-3xl border border-white/10">
              <GalleryCarousel images={galleryImages} />
            </div>
          </div>
        </section>
      ) : null}

      <section id="localizacao" className="shell grid gap-10 py-20 sm:py-28 lg:grid-cols-[.72fr_1.28fr] lg:items-center">
        <div>
          <SectionHeading eyebrow="Onde estamos" title="Perto de você, no Eldorado." />
          <address className="mt-6 not-italic leading-7 text-stone-400">
            Rua São Miguel, 824<br />Eldorado, Porto Velho — RO<br />76811-888
          </address>
          <a
            href="https://www.google.com/maps/search/?api=1&query=Alfa+Para+todos+os+cabelos+Porto+Velho"
            target="_blank"
            rel="noopener noreferrer"
            className="button-secondary mt-7"
          >
            Abrir rota no mapa <span aria-hidden="true">↗</span>
          </a>
        </div>
        <div className="aspect-[4/3] overflow-hidden rounded-3xl border border-white/10 bg-zinc-900 sm:aspect-video">
          <iframe
            title="Mapa com a localização do Espaço Alfa"
            src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d1623.087367220366!2d-63.871474024266924!3d-8.786385786098876!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x92325d64144e26bf%3A0xcb50b4b781eee0fe!2sAlfa%20-%20Para%20todos%20os%20cabelos*21!5e1!3m2!1spt-BR!2sbr!4v1770951104946!5m2!1spt-BR!2sbr"
            width="600"
            height="450"
            allowFullScreen
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            className="h-full w-full grayscale-[.25] contrast-[.9]"
          />
        </div>
      </section>

      <section id="faq" className="border-t border-white/[0.07] bg-white/[0.018] py-20 sm:py-28">
        <div className="shell grid gap-10 lg:grid-cols-[.75fr_1.25fr]">
          <SectionHeading eyebrow="Dúvidas frequentes" title="Antes de sentar na cadeira." />
          <div className="divide-y divide-white/10 border-y border-white/10">
            {[
              ["Posso reagendar meu horário?", "Sim. Fale com a equipe pelo WhatsApp para encontrar um novo horário disponível."],
              ["Vocês atendem por encaixe?", "Quando existe uma janela livre no dia, sim. O agendamento antecipado é a melhor forma de garantir atendimento."],
              ["Quais formas de pagamento são aceitas?", "Aceitamos Pix, cartão de débito e cartão de crédito."],
            ].map(([question, answer]) => (
              <details key={question} className="group py-5">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 font-semibold text-stone-100">
                  {question}<span className="text-xl font-light text-amber-200 transition group-open:rotate-45" aria-hidden="true">+</span>
                </summary>
                <p className="max-w-2xl pb-2 pr-8 text-sm leading-6 text-stone-400">{answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="shell py-16">
        <div className="overflow-hidden rounded-3xl border border-amber-200/20 bg-amber-200 p-7 text-zinc-950 sm:p-10 md:flex md:items-center md:justify-between md:gap-8">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-zinc-700">Seu próximo corte</p>
            <h2 className="mt-2 text-3xl font-semibold md:text-4xl">O melhor horário é o que cabe na sua rotina.</h2>
          </div>
          <Link href="/agendar" className="mt-6 inline-flex min-h-12 shrink-0 items-center justify-center rounded-xl bg-zinc-950 px-6 text-sm font-bold text-white transition hover:bg-zinc-800 md:mt-0">
            Agendar agora <span className="ml-2" aria-hidden="true">→</span>
          </Link>
        </div>
      </section>

      <footer className="border-t border-white/[0.07]">
        <div className="shell flex flex-col gap-4 py-8 text-sm text-stone-500 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Espaço Alfa. Todos os direitos reservados.</p>
          <div className="flex gap-5"><Link href="/cliente/login">Área do cliente</Link><Link href="/admin">Administração</Link></div>
        </div>
      </footer>
    </>
  );
}
