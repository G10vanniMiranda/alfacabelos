import { createHash, randomBytes } from "node:crypto";

export const PASSWORD_RESET_TOKEN_TTL_MINUTES = 30;

export type PasswordResetTokenStatus = "valid" | "invalid" | "expired" | "used";

export function hashPasswordResetToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function createPasswordResetToken(now = new Date()): {
  rawToken: string;
  tokenHash: string;
  expiresAt: Date;
} {
  const rawToken = randomBytes(32).toString("base64url");
  return {
    rawToken,
    tokenHash: hashPasswordResetToken(rawToken),
    expiresAt: new Date(now.getTime() + PASSWORD_RESET_TOKEN_TTL_MINUTES * 60_000),
  };
}

export function evaluatePasswordResetToken(
  token: { expiresAt: Date; usedAt: Date | null } | null,
  now = new Date(),
): PasswordResetTokenStatus {
  if (!token) return "invalid";
  if (token.usedAt) return "used";
  if (token.expiresAt <= now) return "expired";
  return "valid";
}
