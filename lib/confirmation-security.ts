export type ConfirmationRecord = {
  confirmationTokenExpiresAt: Date | null;
  confirmationTokenUsedAt: Date | null;
  status: string;
};

export type ConfirmationDecision = "confirm" | "idempotent-success" | "reject";

export function decideConfirmationTransition(
  booking: ConfirmationRecord | null | undefined,
  now = new Date(),
): ConfirmationDecision {
  if (!booking) return "reject";
  if (booking.confirmationTokenUsedAt && booking.status === "CONFIRMADO") {
    return "idempotent-success";
  }
  if (
    booking.confirmationTokenUsedAt ||
    booking.status !== "PENDENTE" ||
    !booking.confirmationTokenExpiresAt ||
    booking.confirmationTokenExpiresAt <= now
  ) {
    return "reject";
  }
  return "confirm";
}
