export function StatusBadge({ status }: { status: "PENDENTE" | "CONFIRMADO" | "CANCELADO" }) {
  const classes =
    status === "CONFIRMADO"
      ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-200"
      : status === "CANCELADO"
        ? "border-red-400/50 bg-red-500/15 text-red-200"
        : "border-amber-400/50 bg-amber-500/15 text-amber-100";

  return <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${classes}`}>{status}</span>;
}

