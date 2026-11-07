import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";

export const RECOVERY_CODE_LENGTH = 8;
export const RECOVERY_CODE_TTL_MINUTES = 10;
export const RECOVERY_MAX_ATTEMPTS = 5;
export const RECOVERY_SECRET_MIN_LENGTH = 32;
export const RECOVERY_CODE_PATTERN = /^\d{8}$/;

const SEALED_PREFIX = "enc:v1:";
export const REDACTED_DELIVERY_MESSAGE = "[conteúdo removido após o processamento]";

export type RecoveryKeys = { hmac: Buffer; seal: Buffer };
export type RecoveryDeliveryPayload = { text: string; otp: string };

/** Separate keys for code hashing and payload sealing, derived from one server secret. */
export function deriveRecoveryKeys(secret = process.env.PASSWORD_RESET_SECRET): RecoveryKeys | null {
  const value = secret?.trim();
  if (!value || value.length < RECOVERY_SECRET_MIN_LENGTH) return null;
  const derive = (info: string) => Buffer.from(hkdfSync("sha256", value, "alfa-cabelos-password-recovery", info, 32));
  return { hmac: derive("code-hmac-v1"), seal: derive("delivery-seal-v1") };
}

export function generateRecoveryCode(): string {
  return randomInt(0, 10 ** RECOVERY_CODE_LENGTH).toString().padStart(RECOVERY_CODE_LENGTH, "0");
}

/** Opaque browser handle. The issue time lets a handle with no stored challenge expire like a real one. */
export function createRecoveryHandle(now: Date): string {
  return `${randomBytes(32).toString("base64url")}.${now.getTime().toString(36)}`;
}

export function recoveryHandleIssuedAt(handle: string): Date | null {
  const match = /^[A-Za-z0-9_-]{43}\.([0-9a-z]{1,12})$/.exec(handle);
  if (!match) return null;
  const issuedAt = new Date(parseInt(match[1], 36));
  return Number.isNaN(issuedAt.getTime()) ? null : issuedAt;
}

export function hashRecoveryHandle(handle: string): string {
  return createHash("sha256").update(handle).digest("hex");
}

export function hashRecoveryCode(keys: RecoveryKeys, challengeId: string, code: string): string {
  return createHmac("sha256", keys.hmac).update(`${challengeId}:${code}`).digest("hex");
}

export function recoveryCodeMatches(keys: RecoveryKeys, challengeId: string, code: string, expectedHash: string): boolean {
  const supplied = Buffer.from(hashRecoveryCode(keys, challengeId, code), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function isSealedMessage(message: string): boolean {
  return message.startsWith(SEALED_PREFIX);
}

/** AES-256-GCM. `aad` binds the ciphertext to its outbox row so it cannot be replayed into another one. */
export function sealDeliveryPayload(keys: RecoveryKeys, payload: RecoveryDeliveryPayload, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keys.seal, iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return `${SEALED_PREFIX}${[iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".")}`;
}

export function openDeliveryPayload(keys: RecoveryKeys, sealed: string, aad: string): RecoveryDeliveryPayload | null {
  if (!isSealedMessage(sealed)) return null;
  const parts = sealed.slice(SEALED_PREFIX.length).split(".");
  if (parts.length !== 3) return null;
  try {
    const [iv, tag, ciphertext] = parts.map((part) => Buffer.from(part, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", keys.seal, iv);
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(tag);
    const value = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")) as Partial<RecoveryDeliveryPayload>;
    return typeof value.text === "string" && typeof value.otp === "string" ? { text: value.text, otp: value.otp } : null;
  } catch {
    return null;
  }
}
