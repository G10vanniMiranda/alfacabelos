import { normalizeWhatsAppPhone } from "@/lib/notifications/phone";

type Env = Partial<Record<string, string | undefined>>;

/** Hard caps that no environment value can raise. */
export const CANARY_MAX_MESSAGES_CAP = 20;
export const CANARY_MAX_RECIPIENTS = 5;
export const CANARY_MAX_WINDOW_MS = 24 * 60 * 60_000;

export type CanaryConfig = {
  roundId: string;
  instanceId: string;
  expiresAt: Date;
  maxMessages: number;
  recipients: ReadonlySet<string>;
};

export type CanaryState =
  | { status: "disabled" }
  | { status: "invalid"; reason: string }
  | { status: "expired"; config: CanaryConfig }
  | { status: "active"; config: CanaryConfig };

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
// Digits and phone punctuation only: rejects wildcards, ranges and any other pattern syntax.
const LITERAL_PHONE = /^\+?[\d\s().-]{10,20}$/;

/**
 * Homologation canary: the only way a non-production runtime may reach the WhatsApp provider.
 * Every field is mandatory and explicit; any doubt yields "invalid", which blocks sending.
 */
export function readCanaryConfig(env: Env, now: Date): CanaryState {
  if (env.WHATSAPP_CANARY_ENABLED?.trim().toLowerCase() !== "true") return { status: "disabled" };

  // Lower-cased so that changing only the case of the id cannot start a fresh budget.
  const roundId = env.WHATSAPP_CANARY_ROUND_ID?.trim().toLowerCase() ?? "";
  if (!/^[a-z0-9][a-z0-9-]{2,39}$/i.test(roundId)) return { status: "invalid", reason: "canary_round_id" };

  const instanceId = env.WHATSAPP_CANARY_INSTANCE_ID?.trim() ?? "";
  if (!instanceId) return { status: "invalid", reason: "canary_instance" };

  const expiresRaw = env.WHATSAPP_CANARY_EXPIRES_AT?.trim() ?? "";
  const expiresAt = new Date(expiresRaw);
  if (!ISO_WITH_OFFSET.test(expiresRaw) || Number.isNaN(expiresAt.getTime())) return { status: "invalid", reason: "canary_expiry" };
  if (expiresAt.getTime() - now.getTime() > CANARY_MAX_WINDOW_MS) return { status: "invalid", reason: "canary_expiry_too_far" };

  const maxRaw = env.WHATSAPP_CANARY_MAX_MESSAGES?.trim() ?? "";
  const maxMessages = /^\d{1,3}$/.test(maxRaw) ? Number(maxRaw) : 0;
  if (maxMessages < 1 || maxMessages > CANARY_MAX_MESSAGES_CAP) return { status: "invalid", reason: "canary_max_messages" };

  const entries = (env.WHATSAPP_CANARY_ALLOWLIST ?? "").split(",").map((entry) => entry.trim());
  if (!entries.length || entries.length > CANARY_MAX_RECIPIENTS || entries.some((entry) => !LITERAL_PHONE.test(entry))) {
    return { status: "invalid", reason: "canary_allowlist" };
  }
  const recipients = new Set<string>();
  for (const entry of entries) {
    const phone = normalizeWhatsAppPhone(entry);
    if (!phone) return { status: "invalid", reason: "canary_allowlist" };
    recipients.add(phone);
  }

  const config: CanaryConfig = { roundId, instanceId, expiresAt, maxMessages, recipients };
  return expiresAt.getTime() <= now.getTime() ? { status: "expired", config } : { status: "active", config };
}
