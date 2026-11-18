import { randomUUID } from "node:crypto";
import type { NotificationIntentInput } from "@/lib/notifications/service";
import {
  createRecoveryHandle,
  generateRecoveryCode,
  hashRecoveryCode,
  hashRecoveryHandle,
  recoveryCodeMatches,
  recoveryHandleIssuedAt,
  RECOVERY_CODE_PATTERN,
  RECOVERY_CODE_TTL_MINUTES,
  RECOVERY_MAX_ATTEMPTS,
  type RecoveryKeys,
} from "@/lib/auth/password-recovery-crypto";

// Code-based password recovery. Invariants:
// - knowing the phone never grants anything: a code delivered to the account's channel is required;
// - every response is identical for existing and unknown phones (an unknown phone gets a handle
//   with no stored challenge that fails, locks and expires exactly like a real one);
// - the password changes only after a verified, unexpired, unconsumed challenge, consumed atomically.

export const RECOVERY_RESEND_COOLDOWN_SECONDS = 60;
export const RECOVERY_ACCOUNT_LIMIT_PER_HOUR = 5;
const VERIFY_IP_WINDOW_SECONDS = 15 * 60;
const VERIFY_IP_MAX_ATTEMPTS = 30;
const TTL_MS = RECOVERY_CODE_TTL_MINUTES * 60_000;

export type RecoveryChallengeRecord = {
  id: string;
  clientId: string;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  verifiedAt: Date | null;
  consumedAt: Date | null;
  invalidatedAt: Date | null;
};

export type RecoveryClient = { id: string; name: string; phone: string };
export type RateLimitResult = { blocked: boolean; retryAfterSeconds: number };

export type RecoveryStore = {
  findClientByPhone(phone: string): Promise<RecoveryClient | null>;
  countChallengesSince(clientId: string, since: Date): Promise<number>;
  /** One transaction: supersede active challenges, create this one, enqueue its delivery, audit. */
  createChallenge(input: {
    challenge: { id: string; clientId: string; handleHash: string; codeHash: string; channel: string; expiresAt: Date };
    intent: NotificationIntentInput;
    now: Date;
    requestId: string;
  }): Promise<{ deliveryId: string }>;
  findChallenge(handleHash: string): Promise<RecoveryChallengeRecord | null>;
  /** Atomically takes one attempt; null when no attempt is available (locked, expired, used). */
  reserveAttempt(id: string, now: Date, maxAttempts: number): Promise<number | null>;
  markVerified(id: string, now: Date, expiresAt: Date): Promise<boolean>;
  lockChallenge(id: string, clientId: string, now: Date, requestId: string): Promise<void>;
  /** One transaction: consume the verified challenge, set the password, revoke sessions and other credentials, audit. */
  completeReset(input: { challengeId: string; clientId: string; passwordHash: string; now: Date; requestId: string }): Promise<boolean>;
};

export type RecoveryDependencies = {
  store: RecoveryStore;
  keys: RecoveryKeys | null;
  /** Delivery channel currently able to deliver a code, or null when none is. */
  channel: string | null;
  buildIntent(input: { challengeId: string; client: RecoveryClient; code: string; keys: RecoveryKeys }): NotificationIntentInput;
  limitRequest(phone: string, ip: string, requestId: string): Promise<RateLimitResult>;
  rateLimit(input: { scope: string; identifier: string; windowSeconds: number; maxAttempts: number }): Promise<RateLimitResult>;
  hashPassword(password: string): Promise<string>;
  now(): Date;
  log(event: string, fields?: Record<string, string | number | boolean | null | undefined>): void;
};

export type RecoveryRequestResult =
  | { outcome: "sent"; handle: string }
  | { outcome: "unavailable" }
  | { outcome: "rate_limited"; retryAfterSeconds: number };

export type RecoveryVerifyResult =
  | { outcome: "verified" | "invalid" | "expired" | "locked" }
  | { outcome: "rate_limited"; retryAfterSeconds: number };

export type RecoveryCompleteResult = { outcome: "completed" | "expired" };

function handleExpired(handle: string, now: Date): boolean {
  const issuedAt = recoveryHandleIssuedAt(handle);
  return !issuedAt || issuedAt.getTime() + TTL_MS <= now.getTime() || issuedAt.getTime() > now.getTime() + 60_000;
}

export async function requestRecoveryCode(
  deps: RecoveryDependencies,
  input: { phone: string; ip: string; requestId: string },
): Promise<RecoveryRequestResult> {
  // Channel availability does not depend on the account, so this answer reveals nothing.
  if (!deps.channel || !deps.keys) {
    deps.log("password_recovery.delivery_unavailable", { requestId: input.requestId });
    return { outcome: "unavailable" };
  }

  const limit = await deps.limitRequest(input.phone, input.ip, input.requestId);
  if (limit.blocked) {
    return { outcome: "rate_limited", retryAfterSeconds: Math.max(RECOVERY_RESEND_COOLDOWN_SECONDS, limit.retryAfterSeconds) };
  }

  // The response path does the same work for every phone; the account lookup and challenge
  // creation happen afterwards in issueRecoveryChallenge, so latency reveals nothing either.
  return { outcome: "sent", handle: createRecoveryHandle(deps.now()) };
}

/**
 * Runs after the response (Next `after()`): binds a challenge to the handle when the phone belongs
 * to an account. Returns the outbox delivery id to dispatch, or undefined when nothing was issued.
 */
export async function issueRecoveryChallenge(
  deps: RecoveryDependencies,
  input: { phone: string; handle: string; requestId: string },
): Promise<string | undefined> {
  const issuedAt = recoveryHandleIssuedAt(input.handle);
  if (!deps.channel || !deps.keys || !issuedAt) return undefined;
  const client = await deps.store.findClientByPhone(input.phone);
  if (!client) {
    deps.log("password_recovery.request_accepted", { requestId: input.requestId, delivered: false });
    return undefined;
  }

  const now = deps.now();
  if (await deps.store.countChallengesSince(client.id, new Date(now.getTime() - 60 * 60_000)) >= RECOVERY_ACCOUNT_LIMIT_PER_HOUR) {
    deps.log("password_recovery.account_rate_limited", { requestId: input.requestId, clientId: client.id });
    return undefined;
  }

  const challengeId = randomUUID();
  const code = generateRecoveryCode();
  const { deliveryId } = await deps.store.createChallenge({
    challenge: {
      id: challengeId,
      clientId: client.id,
      handleHash: hashRecoveryHandle(input.handle),
      codeHash: hashRecoveryCode(deps.keys, challengeId, code),
      channel: deps.channel,
      // Same deadline as the handle, so a real challenge and a decoy expire at the same instant.
      expiresAt: new Date(issuedAt.getTime() + TTL_MS),
    },
    intent: { ...deps.buildIntent({ challengeId, client, code, keys: deps.keys }), requestId: input.requestId },
    now,
    requestId: input.requestId,
  });
  deps.log("password_recovery.request_accepted", { requestId: input.requestId, delivered: true, clientId: client.id, channel: deps.channel });
  return deliveryId;
}

export async function verifyRecoveryCode(
  deps: RecoveryDependencies,
  input: { handle: string; code: string; ip: string; requestId: string },
): Promise<RecoveryVerifyResult> {
  const now = deps.now();
  if (!input.handle || handleExpired(input.handle, now)) return { outcome: "expired" };
  if (!deps.keys || !RECOVERY_CODE_PATTERN.test(input.code)) return { outcome: "invalid" };

  const ipLimit = await deps.rateLimit({
    scope: "client-password-recovery-verify-ip", identifier: input.ip,
    windowSeconds: VERIFY_IP_WINDOW_SECONDS, maxAttempts: VERIFY_IP_MAX_ATTEMPTS,
  });
  if (ipLimit.blocked) return { outcome: "rate_limited", retryAfterSeconds: ipLimit.retryAfterSeconds };

  const handleHash = hashRecoveryHandle(input.handle);
  const challenge = await deps.store.findChallenge(handleHash);
  if (!challenge) return verifyDecoy(deps, handleHash, 0);

  if (challenge.attempts >= RECOVERY_MAX_ATTEMPTS) return { outcome: "locked" };
  // A superseded or used handle must look exactly like an unknown phone's handle, including
  // where it locks (attempts already spent count), or re-requesting becomes an existence oracle.
  if (challenge.consumedAt || challenge.invalidatedAt) return verifyDecoy(deps, handleHash, challenge.attempts);
  if (challenge.expiresAt <= now) return { outcome: "expired" };
  if (challenge.verifiedAt) return { outcome: "verified" };
  return checkCode(deps, deps.keys, challenge, input.code, now, input.requestId);
}

/** No code can match: mirror the real attempt limit (lock on the 5th miss overall). */
async function verifyDecoy(deps: RecoveryDependencies, handleHash: string, attemptsSpent: number): Promise<RecoveryVerifyResult> {
  const remaining = RECOVERY_MAX_ATTEMPTS - 1 - attemptsSpent;
  if (remaining <= 0) return { outcome: "locked" };
  const decoy = await deps.rateLimit({
    scope: "client-password-recovery-decoy", identifier: handleHash,
    windowSeconds: RECOVERY_CODE_TTL_MINUTES * 60, maxAttempts: remaining,
  });
  return { outcome: decoy.blocked ? "locked" : "invalid" };
}

async function checkCode(
  deps: RecoveryDependencies,
  keys: RecoveryKeys,
  challenge: RecoveryChallengeRecord,
  code: string,
  now: Date,
  requestId: string,
): Promise<RecoveryVerifyResult> {
  const attempts = await deps.store.reserveAttempt(challenge.id, now, RECOVERY_MAX_ATTEMPTS);
  if (attempts === null) return { outcome: "locked" };

  if (recoveryCodeMatches(keys, challenge.id, code, challenge.codeHash)) {
    const verified = await deps.store.markVerified(challenge.id, now, new Date(now.getTime() + TTL_MS));
    deps.log(verified ? "password_recovery.code_verified" : "password_recovery.code_verify_race", {
      requestId, clientId: challenge.clientId,
    });
    return { outcome: verified ? "verified" : "expired" };
  }

  if (attempts >= RECOVERY_MAX_ATTEMPTS) {
    await deps.store.lockChallenge(challenge.id, challenge.clientId, now, requestId);
    deps.log("password_recovery.challenge_locked", { requestId, clientId: challenge.clientId });
    return { outcome: "locked" };
  }
  deps.log("password_recovery.code_rejected", { requestId, clientId: challenge.clientId, attempts });
  return { outcome: "invalid" };
}

export async function completeRecovery(
  deps: RecoveryDependencies,
  input: { handle: string; password: string; requestId: string },
): Promise<RecoveryCompleteResult> {
  const now = deps.now();
  // The stored expiry is authoritative here: verification extends it past the handle's issue window.
  if (!input.handle) return { outcome: "expired" };
  const challenge = await deps.store.findChallenge(hashRecoveryHandle(input.handle));
  if (!challenge?.verifiedAt || challenge.consumedAt || challenge.invalidatedAt || challenge.expiresAt <= now) {
    return { outcome: "expired" };
  }

  const passwordHash = await deps.hashPassword(input.password);
  const completed = await deps.store.completeReset({
    challengeId: challenge.id, clientId: challenge.clientId, passwordHash, now, requestId: input.requestId,
  });
  deps.log(completed ? "password_recovery.completed" : "password_recovery.complete_rejected", {
    requestId: input.requestId, clientId: challenge.clientId,
  });
  return { outcome: completed ? "completed" : "expired" };
}
