"use client";

import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[ui-error]", { digest: error.digest, name: error.name });
  }, [error]);

  return (
    <main id="conteudo" className="shell grid min-h-[70svh] place-items-center py-12">
      <section className="premium-card w-full max-w-xl rounded-3xl p-7 text-center sm:p-10">
        <span aria-hidden="true" className="mx-auto grid size-12 place-items-center rounded-full bg-brand-highlight/10 text-brand-highlight">!</span>
        <h1 className="mt-5 text-3xl font-semibold text-stone-100">Não foi possível carregar esta página.</h1>
        <p className="mt-3 text-sm leading-6 text-stone-400">O serviço pode estar temporariamente indisponível. Seus dados não foram alterados.</p>
        <button type="button" onClick={reset} className="button-primary mt-6">Tentar novamente</button>
      </section>
    </main>
  );
}
