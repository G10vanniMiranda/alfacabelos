import type { BookingStatus } from "@/types/domain";

export function StatusBadge({ status }: { status: BookingStatus }) {
  const classes =
    status === "CONFIRMADO"
      ? "border-success/50 bg-success/15 text-success-soft"
      : status === "CANCELADO" || status === "AUSENTE"
        ? "border-danger/50 bg-danger/15 text-danger-soft"
        : status === "CONCLUIDO"
          ? "border-brand/50 bg-brand/15 text-brand-soft"
          : "border-warning/50 bg-warning/15 text-warning-soft";

  return <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${classes}`}>{status}</span>;
}

