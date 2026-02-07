"use client";

export function Stepper({ currentStep }: { currentStep: number }) {
  const steps = ["Servico", "Barbeiro", "Data e horario", "Seus dados"];

  return (
    <ol className="grid gap-3 sm:grid-cols-4">
      {steps.map((step, index) => {
        const number = index + 1;
        const active = number === currentStep;
        const done = number < currentStep;

        return (
          <li
            key={step}
            className={`rounded-lg border px-3 py-2 text-sm ${
              active
                ? "border-cyan-300 bg-cyan-500/10 text-cyan-100"
                : done
                  ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
                  : "border-zinc-700 bg-zinc-900 text-zinc-400"
            }`}
          >
            <span className="font-semibold">Passo {number}</span>
            <p>{step}</p>
          </li>
        );
      })}
    </ol>
  );
}

