"use client";

export function Stepper({ currentStep }: { currentStep: number }) {
  const steps = ["Serviço", "Profissional", "Data e horário", "Revisão"];

  return (
    <ol aria-label="Etapas do agendamento" className="grid grid-cols-4 gap-1.5 sm:gap-2">
      {steps.map((step, index) => {
        const number = index + 1;
        const active = number === currentStep;
        const done = number < currentStep;

        return (
          <li
            key={step}
            aria-current={active ? "step" : undefined}
            className={`flex min-w-0 items-center gap-2 rounded-xl border px-2 py-2.5 text-sm transition sm:gap-3 sm:px-3 ${
              active
                ? "border-brand-highlight/60 bg-brand-highlight/10 text-brand-soft"
                : done
                  ? "border-success/40 bg-success/10 text-success-soft"
                  : "border-zinc-800 bg-zinc-950/50 text-zinc-400"
            }`}
          >
            <span
              className={`grid size-7 shrink-0 place-items-center rounded-full border text-xs font-bold sm:size-8 ${
                active
                  ? "border-brand-highlight bg-brand-highlight text-zinc-950"
                  : done
                    ? "border-success-soft bg-success text-zinc-950"
                    : "border-zinc-700 bg-zinc-900 text-copy-muted"
              }`}
            >
              {done ? "✓" : number}
            </span>
            <span className="min-w-0">
              <span className="hidden text-[10px] font-semibold uppercase tracking-wide opacity-70 sm:block">Passo {number}</span>
              <span className="hidden truncate font-semibold sm:block">{step}</span>
              <span className="sr-only sm:hidden">{step}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

