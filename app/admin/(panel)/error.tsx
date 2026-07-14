"use client";

import { useEffect } from "react";

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[admin-ui-error]", { digest: error.digest, name: error.name });
  }, [error]);

  return (
    <section role="alert" className="premium-card rounded-3xl p-7">
      <p className="eyebrow">Indisponibilidade temporária</p>
      <h1 className="mt-3 text-3xl font-semibold text-stone-100">Não foi possível carregar os dados operacionais.</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-400">Nenhum indicador fictício foi exibido. Verifique a conexão com o banco e tente novamente.</p>
      <button type="button" onClick={reset} className="button-primary mt-6">Tentar novamente</button>
    </section>
  );
}
