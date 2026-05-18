"use client";

export function Stepper({ currentStep }: { currentStep: number }) {
  const steps = ["Servico", "Data e horario", "Seus dados"];

  return (
    <ol className="grid gap-2 sm:grid-cols-3">
      {steps.map((step, index) => {
        const number = index + 1;
        const active = number === currentStep;
        const done = number < currentStep;

        return (
          <li
            key={step}
            className={`flex items-center gap-3 rounded-lg border px-3 py-3 text-sm transition ${
              active
                ? "border-cyan-300 bg-cyan-500/10 text-cyan-100"
                : done
                  ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
                  : "border-zinc-800 bg-zinc-950/50 text-zinc-400"
            }`}
          >
            <span
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border text-xs font-bold ${
                active
                  ? "border-cyan-300 bg-cyan-400 text-zinc-950"
                  : done
                    ? "border-emerald-300 bg-emerald-400 text-zinc-950"
                    : "border-zinc-700 bg-zinc-900 text-zinc-500"
              }`}
            >
              {number}
            </span>
            <span>
              <span className="block text-[11px] font-semibold uppercase tracking-wide opacity-70">Passo {number}</span>
              <span className="block font-semibold">{step}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

