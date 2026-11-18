import assert from "node:assert/strict";
import { scryptSync, timingSafeEqual } from "node:crypto";
import test from "node:test";
import type { NotificationIntentInput } from "../lib/notifications/service";
import {
  createRecoveryHandle,
  deriveRecoveryKeys,
  generateRecoveryCode,
  hashRecoveryCode,
  isSealedMessage,
  openDeliveryPayload,
  recoveryCodeMatches,
  recoveryHandleIssuedAt,
  RECOVERY_MAX_ATTEMPTS,
  sealDeliveryPayload,
} from "../lib/auth/password-recovery-crypto";
import {
  completeRecovery,
  issueRecoveryChallenge,
  requestRecoveryCode,
  verifyRecoveryCode,
  type RecoveryChallengeRecord,
  type RecoveryDependencies,
  type RecoveryStore,
} from "../lib/auth/password-recovery";
import { createRecoveryDependencies, resolveRecoveryChannel } from "../lib/auth/password-recovery-store";
import { hashClientPassword } from "../lib/auth/client-store";
import { normalizeBrazilPhone } from "../lib/phone";
import { evaluateNotificationValidity, notificationValidityUpperBound } from "../lib/notifications/validity-policy";
import { payload } from "../lib/notifications/whatsapp-provider";
import { checkCriticalConfiguration } from "../lib/observability/health";

// Synthetic identities only (DDD 20 is not assigned in Brazil).
const KNOWN_PHONE = "(20) 90000-0031";
const UNKNOWN_PHONE = "(20) 90000-0099";
const SECRET = "test-only-recovery-secret-0123456789abcdef";
const keys = deriveRecoveryKeys(SECRET)!;

function passwordMatches(stored: string | null, password: string): boolean {
  if (!stored) return false;
  const [salt, hash] = stored.split(":");
  const expected = Buffer.from(hash, "hex");
  const derived = scryptSync(password, salt, 64);
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

type ChallengeRow = RecoveryChallengeRecord & { handleHash: string; channel: string; createdAt: Date };
type ClientRow = { id: string; name: string; phone: string; phoneNormalized: string; passwordHash: string | null; hasPassword: boolean; sessions: number; legacyTokensOpen: number };

/** In-memory store with the same compare-and-set semantics as the Prisma store. */
function createWorld(options: { channel?: string | null; withKeys?: boolean } = {}) {
  let current = new Date("2026-11-07T12:00:00.000Z");
  const clients: ClientRow[] = [
    { id: "client-known", name: "[QA] Cliente Sintético", phone: KNOWN_PHONE, phoneNormalized: "20900000031", passwordHash: null, hasPassword: true, sessions: 2, legacyTokensOpen: 1 },
  ];
  const challenges: ChallengeRow[] = [];
  const intents: NotificationIntentInput[] = [];
  const audits: string[] = [];
  const rateEvents = new Map<string, number[]>();
  const logs: string[] = [];
  const yieldTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

  const rateLimit: RecoveryDependencies["rateLimit"] = async ({ scope, identifier, windowSeconds, maxAttempts }) => {
    const key = `${scope}:${identifier}`;
    const since = current.getTime() - windowSeconds * 1000;
    const events = (rateEvents.get(key) ?? []).filter((at) => at >= since);
    if (events.length >= maxAttempts) {
      return { blocked: true, retryAfterSeconds: Math.max(1, Math.ceil((events[0] + windowSeconds * 1000 - current.getTime()) / 1000)) };
    }
    rateEvents.set(key, [...events, current.getTime()]);
    return { blocked: false, retryAfterSeconds: 0 };
  };

  const store: RecoveryStore = {
    async findClientByPhone(phone) {
      const national = normalizeBrazilPhone(phone)?.national;
      const row = clients.find((client) => client.phoneNormalized === national);
      return row ? { id: row.id, name: row.name, phone: row.phone } : null;
    },
    async countChallengesSince(clientId, since) {
      return challenges.filter((row) => row.clientId === clientId && row.createdAt >= since).length;
    },
    async createChallenge({ challenge, intent, now }) {
      await yieldTurn();
      for (const row of challenges) if (row.clientId === challenge.clientId && !row.consumedAt && !row.invalidatedAt) row.invalidatedAt = now;
      challenges.push({ ...challenge, attempts: 0, verifiedAt: null, consumedAt: null, invalidatedAt: null, createdAt: now });
      intents.push(intent);
      audits.push(`requested:${challenge.clientId}`);
      return { deliveryId: `delivery-${challenge.id}` };
    },
    async findChallenge(handleHash) {
      await yieldTurn();
      const row = challenges.find((item) => item.handleHash === handleHash);
      return row ? { ...row } : null;
    },
    async reserveAttempt(id, now, maxAttempts) {
      await yieldTurn();
      const row = challenges.find((item) => item.id === id);
      if (!row || row.attempts >= maxAttempts || row.verifiedAt || row.consumedAt || row.invalidatedAt || row.expiresAt <= now) return null;
      row.attempts += 1;
      return row.attempts;
    },
    async markVerified(id, now, expiresAt) {
      await yieldTurn();
      const row = challenges.find((item) => item.id === id);
      if (!row || row.verifiedAt || row.consumedAt || row.invalidatedAt || row.expiresAt <= now) return false;
      row.verifiedAt = now;
      row.expiresAt = expiresAt;
      return true;
    },
    async lockChallenge(id, clientId, now) {
      const row = challenges.find((item) => item.id === id);
      if (row && !row.invalidatedAt) row.invalidatedAt = now;
      audits.push(`locked:${clientId}`);
    },
    async completeReset({ challengeId, clientId, passwordHash, now }) {
      await yieldTurn();
      const row = challenges.find((item) => item.id === challengeId && item.clientId === clientId);
      if (!row || !row.verifiedAt || row.consumedAt || row.invalidatedAt || row.expiresAt <= now) return false;
      row.consumedAt = now;
      const client = clients.find((item) => item.id === clientId)!;
      Object.assign(client, { passwordHash, hasPassword: true, sessions: 0, legacyTokensOpen: 0 });
      for (const other of challenges) if (other.clientId === clientId && other.id !== challengeId && !other.consumedAt && !other.invalidatedAt) other.invalidatedAt = now;
      audits.push(`completed:${clientId}`);
      return true;
    },
  };

  const deps = createRecoveryDependencies({
    store,
    keys: options.withKeys === false ? null : keys,
    channel: options.channel === undefined ? "whatsapp" : options.channel,
    limitRequest: (phone) => rateLimit({ scope: "cooldown", identifier: normalizeBrazilPhone(phone)?.national ?? phone, windowSeconds: 60, maxAttempts: 1 }),
    rateLimit,
    now: () => new Date(current.getTime()),
    log: (event, fields) => { logs.push(JSON.stringify({ event, ...fields })); },
  });

  return {
    deps, clients, challenges, intents, audits, logs,
    advance(ms: number) { current = new Date(current.getTime() + ms); },
    lastCode(): string {
      const intent = intents.at(-1)!;
      return openDeliveryPayload(keys, intent.message, intent.idempotencyKey)!.otp;
    },
  };
}

const ip = "203.0.113.10";
// Mirrors the action: the response first, then the after() step that issues the challenge.
const request = async (world: ReturnType<typeof createWorld>, phone = KNOWN_PHONE) => {
  const result = await requestRecoveryCode(world.deps, { phone, ip, requestId: "req-test" });
  if (result.outcome !== "sent") return result;
  const deliveryId = await issueRecoveryChallenge(world.deps, { phone, handle: result.handle, requestId: "req-test" });
  return { ...result, deliveryId };
};
const verify = (world: ReturnType<typeof createWorld>, handle: string, code: string) =>
  verifyRecoveryCode(world.deps, { handle, code, ip, requestId: "req-test" });
const complete = (world: ReturnType<typeof createWorld>, handle: string, password = "nova-senha-segura") =>
  completeRecovery(world.deps, { handle, password, requestId: "req-test" });
const wrongCode = (code: string) => String((Number(code) + 1) % 100_000_000).padStart(8, "0");

test("código: 8 dígitos por CSPRNG, HMAC ligado ao desafio e comparação constante", () => {
  const codes = new Set(Array.from({ length: 200 }, generateRecoveryCode));
  for (const code of codes) assert.match(code, /^\d{8}$/);
  assert.ok(codes.size > 195, "códigos não devem se repetir em amostra pequena");
  const hash = hashRecoveryCode(keys, "challenge-a", "12345678");
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.notEqual(hash, hashRecoveryCode(keys, "challenge-b", "12345678"));
  assert.notEqual(hash, hashRecoveryCode(deriveRecoveryKeys(`${SECRET}-other`)!, "challenge-a", "12345678"));
  assert.equal(recoveryCodeMatches(keys, "challenge-a", "12345678", hash), true);
  assert.equal(recoveryCodeMatches(keys, "challenge-a", "12345679", hash), false);
  assert.equal(deriveRecoveryKeys("curto-demais"), null);
  assert.equal(deriveRecoveryKeys(undefined), null);
});

test("handle opaco carrega só o instante de emissão", () => {
  const issued = new Date("2026-11-07T12:00:00.000Z");
  const handle = createRecoveryHandle(issued);
  assert.equal(recoveryHandleIssuedAt(handle)?.toISOString(), issued.toISOString());
  assert.equal(recoveryHandleIssuedAt("lixo"), null);
  assert.notEqual(createRecoveryHandle(issued), handle);
});

test("payload selado: AES-GCM, ligado à linha e à prova de adulteração", () => {
  const sealed = sealDeliveryPayload(keys, { text: "código 12345678", otp: "12345678" }, "password-reset-code:a");
  assert.ok(isSealedMessage(sealed));
  assert.ok(!sealed.includes("12345678"));
  assert.deepEqual(openDeliveryPayload(keys, sealed, "password-reset-code:a"), { text: "código 12345678", otp: "12345678" });
  assert.equal(openDeliveryPayload(keys, sealed, "password-reset-code:b"), null, "outra linha");
  assert.equal(openDeliveryPayload(deriveRecoveryKeys(`${SECRET}-rotated`)!, sealed, "password-reset-code:a"), null, "segredo trocado");
  const tampered = `${sealed.slice(0, -2)}${sealed.endsWith("A") ? "B" : "A"}A`;
  assert.equal(openDeliveryPayload(keys, tampered, "password-reset-code:a"), null, "ciphertext alterado");
});

test("fluxo completo: código válido define a senha, revoga sessões e invalida links antigos", async () => {
  const world = createWorld();
  world.clients[0].passwordHash = await hashClientPassword("senha-antiga-123");

  const requested = await request(world);
  assert.equal(requested.outcome, "sent");
  if (requested.outcome !== "sent") return;
  assert.ok(requested.deliveryId);
  const intent = world.intents[0];
  assert.equal(intent.event, "PASSWORD_RESET");
  assert.match(intent.idempotencyKey, /^password-reset-code:[0-9a-f-]{36}$/);
  assert.ok(isSealedMessage(intent.message), "mensagem do outbox deve estar selada");
  const code = world.lastCode();
  assert.ok(!intent.message.includes(code), "código nunca em texto puro no outbox");

  assert.equal((await complete(world, requested.handle)).outcome, "expired", "sem verificação não troca a senha");
  assert.ok(passwordMatches(world.clients[0].passwordHash, "senha-antiga-123"));

  assert.equal((await verify(world, requested.handle, code)).outcome, "verified");
  assert.equal((await complete(world, requested.handle)).outcome, "completed");

  const client = world.clients[0];
  assert.ok(passwordMatches(client.passwordHash, "nova-senha-segura"), "nova senha funciona");
  assert.ok(!passwordMatches(client.passwordHash, "senha-antiga-123"), "senha anterior deixa de funcionar");
  assert.equal(client.hasPassword, true);
  assert.equal(client.sessions, 0, "sessões anteriores revogadas");
  assert.equal(client.legacyTokensOpen, 0, "links do fluxo antigo invalidados");
  assert.deepEqual(world.audits, ["requested:client-known", "completed:client-known"]);
});

test("primeira senha de cliente cadastrado pelo barbeiro usa o mesmo fluxo", async () => {
  const world = createWorld();
  Object.assign(world.clients[0], { hasPassword: false, passwordHash: null });
  const requested = await request(world);
  if (requested.outcome !== "sent") return assert.fail("deveria enviar");
  assert.equal((await verify(world, requested.handle, world.lastCode())).outcome, "verified");
  assert.equal((await complete(world, requested.handle, "primeira-senha-1")).outcome, "completed");
  assert.equal(world.clients[0].hasPassword, true);
  assert.ok(passwordMatches(world.clients[0].passwordHash, "primeira-senha-1"));
});

test("código reutilizado e conclusão repetida são rejeitados", async () => {
  const world = createWorld();
  const requested = await request(world);
  if (requested.outcome !== "sent") return assert.fail("deveria enviar");
  const code = world.lastCode();
  await verify(world, requested.handle, code);
  assert.equal((await complete(world, requested.handle)).outcome, "completed");
  assert.equal((await verify(world, requested.handle, code)).outcome, "invalid", "código usado nunca volta a verificar");
  assert.equal((await complete(world, requested.handle, "outra-senha-999")).outcome, "expired");
  assert.ok(passwordMatches(world.clients[0].passwordHash, "nova-senha-segura"));
});

test("código incorreto e limite de 5 tentativas: o código certo não passa depois do bloqueio", async () => {
  const world = createWorld();
  const requested = await request(world);
  if (requested.outcome !== "sent") return assert.fail("deveria enviar");
  const code = world.lastCode();
  const outcomes = [];
  for (let index = 0; index < RECOVERY_MAX_ATTEMPTS; index += 1) outcomes.push((await verify(world, requested.handle, wrongCode(code))).outcome);
  assert.deepEqual(outcomes, ["invalid", "invalid", "invalid", "invalid", "locked"]);
  assert.equal((await verify(world, requested.handle, code)).outcome, "locked");
  assert.equal((await complete(world, requested.handle)).outcome, "expired");
  assert.ok(world.audits.includes("locked:client-known"));
});

test("formato inválido não consome tentativa", async () => {
  const world = createWorld();
  const requested = await request(world);
  if (requested.outcome !== "sent") return assert.fail("deveria enviar");
  assert.equal((await verify(world, requested.handle, "1234")).outcome, "invalid");
  assert.equal(world.challenges[0].attempts, 0);
});

test("código expirado após 10 minutos", async () => {
  const world = createWorld();
  const requested = await request(world);
  if (requested.outcome !== "sent") return assert.fail("deveria enviar");
  const code = world.lastCode();
  world.advance(10 * 60_000 + 1);
  assert.equal((await verify(world, requested.handle, code)).outcome, "expired");
});

test("verificação concede 10 minutos para definir a senha; depois expira", async () => {
  const world = createWorld();
  const requested = await request(world);
  if (requested.outcome !== "sent") return assert.fail("deveria enviar");
  world.advance(9 * 60_000);
  assert.equal((await verify(world, requested.handle, world.lastCode())).outcome, "verified");
  world.advance(9 * 60_000);
  assert.equal((await complete(world, requested.handle)).outcome, "completed", "janela conta a partir da verificação");

  const second = createWorld();
  const again = await request(second);
  if (again.outcome !== "sent") return assert.fail("deveria enviar");
  await verify(second, again.handle, second.lastCode());
  second.advance(10 * 60_000 + 1);
  assert.equal((await complete(second, again.handle)).outcome, "expired");
});

test("reenvio: respeita o intervalo e o novo código substitui o anterior", async () => {
  const world = createWorld();
  const first = await request(world);
  if (first.outcome !== "sent") return assert.fail("deveria enviar");
  const firstCode = world.lastCode();
  const blocked = await request(world);
  assert.equal(blocked.outcome, "rate_limited");
  assert.equal(world.intents.length, 1);

  world.advance(61_000);
  const second = await request(world);
  if (second.outcome !== "sent") return assert.fail("deveria reenviar");
  const secondCode = world.lastCode();
  assert.equal((await verify(world, first.handle, firstCode)).outcome, "invalid", "código anterior invalidado (responde como decoy)");
  assert.equal((await verify(world, second.handle, secondCode)).outcome, "verified");
});

test("limite por conta: no máximo 5 desafios por hora, sem revelar o bloqueio", async () => {
  const world = createWorld();
  for (let index = 0; index < 6; index += 1) {
    const result = await request(world);
    assert.equal(result.outcome, "sent");
    world.advance(61_000);
  }
  assert.equal(world.challenges.length, 5);
});

test("enumeração: telefone inexistente produz respostas e bloqueios idênticos", async () => {
  const real = createWorld();
  const decoy = createWorld();
  const realRequest = await request(real, KNOWN_PHONE);
  const decoyRequest = await request(decoy, UNKNOWN_PHONE);
  assert.equal(realRequest.outcome, "sent");
  assert.equal(decoyRequest.outcome, "sent");
  if (realRequest.outcome !== "sent" || decoyRequest.outcome !== "sent") return;
  assert.equal(decoy.challenges.length, 0, "nenhum desafio para telefone inexistente");
  assert.equal(decoy.intents.length, 0, "nenhuma entrega para telefone inexistente");
  assert.equal(realRequest.handle.length, decoyRequest.handle.length);

  const code = real.lastCode();
  const realOutcomes = [];
  const decoyOutcomes = [];
  for (let index = 0; index < RECOVERY_MAX_ATTEMPTS + 1; index += 1) {
    realOutcomes.push((await verify(real, realRequest.handle, wrongCode(code))).outcome);
    decoyOutcomes.push((await verify(decoy, decoyRequest.handle, wrongCode(code))).outcome);
  }
  assert.deepEqual(decoyOutcomes, realOutcomes);
  assert.equal((await complete(decoy, decoyRequest.handle)).outcome, "expired");

  const expiredReal = createWorld();
  const expiredDecoy = createWorld();
  const a = await request(expiredReal, KNOWN_PHONE);
  const b = await request(expiredDecoy, UNKNOWN_PHONE);
  if (a.outcome !== "sent" || b.outcome !== "sent") return assert.fail("deveria enviar");
  expiredReal.advance(10 * 60_000 + 1);
  expiredDecoy.advance(10 * 60_000 + 1);
  assert.equal((await verify(expiredReal, a.handle, "00000000")).outcome, (await verify(expiredDecoy, b.handle, "00000000")).outcome);
});

test("enumeração: handle substituído por novo pedido se comporta como o de telefone inexistente", async () => {
  for (const spentBefore of [0, 2, 4]) {
    const runs = [];
    for (const phone of [KNOWN_PHONE, UNKNOWN_PHONE]) {
      const world = createWorld();
      const first = await request(world, phone);
      if (first.outcome !== "sent") return assert.fail("deveria enviar");
      const outcomes: string[] = [];
      for (let index = 0; index < spentBefore; index += 1) outcomes.push((await verify(world, first.handle, "00000001")).outcome);
      world.advance(61_000);
      await request(world, phone);
      for (let index = 0; index < RECOVERY_MAX_ATTEMPTS + 1 - spentBefore; index += 1) outcomes.push((await verify(world, first.handle, "00000001")).outcome);
      runs.push(outcomes);
    }
    assert.deepEqual(runs[0], runs[1], `tentativas antes do novo pedido: ${spentBefore}`);
  }
});

test("timing: a resposta da solicitação não consulta nem grava dados da conta", async () => {
  const world = createWorld();
  const touched: string[] = [];
  const spy = new Proxy(world.deps.store, {
    get(target, key) {
      const value = target[key as keyof RecoveryStore];
      return typeof value === "function" ? (...args: unknown[]) => { touched.push(String(key)); return (value as (...a: unknown[]) => unknown).apply(target, args); } : value;
    },
  });
  const result = await requestRecoveryCode({ ...world.deps, store: spy }, { phone: KNOWN_PHONE, ip, requestId: "req-test" });
  assert.equal(result.outcome, "sent");
  assert.deepEqual(touched, [], "nenhum acesso ao store no caminho da resposta");
});

test("informar o telefone sozinho nunca concede acesso", async () => {
  const world = createWorld();
  const requested = await request(world);
  if (requested.outcome !== "sent") return assert.fail("deveria enviar");
  assert.equal((await complete(world, requested.handle)).outcome, "expired");
  assert.equal((await complete(world, "")).outcome, "expired");
  assert.equal((await verify(world, "", world.lastCode())).outcome, "expired", "sem o cookie do navegador");
  const forged = createRecoveryHandle(new Date("2026-11-07T12:00:00.000Z"));
  assert.equal((await verify(world, forged, world.lastCode())).outcome, "invalid", "handle forjado não acha o desafio");
  assert.equal(world.clients[0].passwordHash, null);
});

test("concorrência: duas conclusões simultâneas, só uma vence", async () => {
  const world = createWorld();
  const requested = await request(world);
  if (requested.outcome !== "sent") return assert.fail("deveria enviar");
  await verify(world, requested.handle, world.lastCode());
  const results = await Promise.all([complete(world, requested.handle, "senha-a-123456"), complete(world, requested.handle, "senha-b-123456")]);
  assert.deepEqual(results.map((item) => item.outcome).sort(), ["completed", "expired"]);
  assert.equal(world.audits.filter((item) => item.startsWith("completed")).length, 1);
});

test("concorrência: palpites simultâneos nunca passam de 5 tentativas", async () => {
  const world = createWorld();
  const requested = await request(world);
  if (requested.outcome !== "sent") return assert.fail("deveria enviar");
  const code = world.lastCode();
  const results = await Promise.all(Array.from({ length: 12 }, () => verify(world, requested.handle, wrongCode(code))));
  assert.equal(world.challenges[0].attempts, RECOVERY_MAX_ATTEMPTS);
  assert.ok(results.every((item) => item.outcome === "invalid" || item.outcome === "locked"));
  assert.equal((await verify(world, requested.handle, code)).outcome, "locked");
});

test("falha de canal: sem entrega disponível a resposta é honesta e igual para qualquer telefone", async () => {
  for (const options of [{ channel: null }, { withKeys: false }]) {
    const world = createWorld(options);
    assert.deepEqual(await request(world, KNOWN_PHONE), { outcome: "unavailable" });
    assert.deepEqual(await request(world, UNKNOWN_PHONE), { outcome: "unavailable" });
    assert.equal(world.challenges.length, 0);
  }
});

test("vazamento: código e handle nunca aparecem em logs, auditoria ou respostas", async () => {
  const world = createWorld();
  const captured: string[] = [];
  const original = { info: console.info, warn: console.warn, error: console.error };
  console.info = console.warn = console.error = (...args: unknown[]) => { captured.push(args.map(String).join(" ")); };
  try {
    const requested = await request(world);
    if (requested.outcome !== "sent") return assert.fail("deveria enviar");
    const code = world.lastCode();
    const responses = [
      await verify(world, requested.handle, wrongCode(code)),
      await verify(world, requested.handle, code),
      await complete(world, requested.handle),
    ];
    const haystack = [...world.logs, ...captured, ...world.audits, JSON.stringify(responses)].join("\n");
    assert.ok(!haystack.includes(code), "código vazou");
    assert.ok(!haystack.includes(requested.handle), "handle vazou");
    assert.ok(!haystack.includes(requested.handle.split(".")[0]), "parte aleatória do handle vazou");
  } finally {
    Object.assign(console, original);
  }
});

test("política de validade: entrega do código só enquanto o desafio pode ser verificado", () => {
  const now = new Date("2026-11-07T12:05:00.000Z");
  const subject = { event: "PASSWORD_RESET" as const, idempotencyKey: "password-reset-code:6f9619ff-8b86-4d11-b42d-00c04fc964ff", bookingId: null, createdAt: new Date("2026-11-07T12:00:00.000Z") };
  const base = { booking: null, passwordResetToken: null };
  const challenge = { expiresAt: new Date("2026-11-07T12:10:00.000Z"), verifiedAt: null, consumedAt: null, invalidatedAt: null };
  assert.deepEqual(evaluateNotificationValidity(subject, { ...base, passwordResetChallenge: challenge }, now), { outcome: "VALID", validUntil: challenge.expiresAt });
  assert.equal(evaluateNotificationValidity(subject, { ...base, passwordResetChallenge: null }, now).outcome, "INVALID");
  assert.equal(evaluateNotificationValidity(subject, { ...base, passwordResetChallenge: { ...challenge, verifiedAt: now } }, now).outcome, "INVALID");
  assert.equal(evaluateNotificationValidity(subject, { ...base, passwordResetChallenge: { ...challenge, invalidatedAt: now } }, now).outcome, "INVALID");
  assert.equal(evaluateNotificationValidity(subject, { ...base, passwordResetChallenge: challenge }, challenge.expiresAt).outcome, "INVALID");
  assert.equal(notificationValidityUpperBound(subject)?.toISOString(), "2026-11-07T12:10:00.000Z");
});

test("canal: só disponível quando consegue entregar de verdade", () => {
  const ready = { WHATSAPP_ENABLED: "true", WHATSAPP_PROVIDER: "evolution", WHATSAPP_API_URL: "https://wa.example.invalid/send", WHATSAPP_API_TOKEN: "t", PASSWORD_RESET_SECRET: SECRET };
  assert.equal(resolveRecoveryChannel(ready), "whatsapp");
  assert.equal(resolveRecoveryChannel({ ...ready, WHATSAPP_ENABLED: "false" }), null);
  assert.equal(resolveRecoveryChannel({ ...ready, WHATSAPP_API_TOKEN: "" }), null);
  assert.equal(resolveRecoveryChannel({ ...ready, PASSWORD_RESET_SECRET: "curto" }), null);
  assert.equal(resolveRecoveryChannel({ ...ready, WHATSAPP_PROVIDER: "meta" }), null, "Meta exige template de autenticação");
  assert.equal(resolveRecoveryChannel({ ...ready, WHATSAPP_PROVIDER: "meta", WHATSAPP_AUTH_TEMPLATE_NAME: "alfa_codigo" }), "whatsapp");
});

test("provedor Meta: código vai em template de autenticação; demais mensagens seguem em texto", () => {
  const env = { WHATSAPP_AUTH_TEMPLATE_NAME: "alfa_codigo" };
  const template = payload("meta", "5520900000031", "texto", "12345678", env) as { type: string; template: { name: string; language: { code: string }; components: Array<{ parameters: Array<{ text: string }> }> } };
  assert.equal(template.type, "template");
  assert.equal(template.template.name, "alfa_codigo");
  assert.equal(template.template.language.code, "pt_BR");
  assert.deepEqual(template.template.components.map((item) => item.parameters[0].text), ["12345678", "12345678"]);
  assert.equal((payload("meta", "5520900000031", "texto", undefined, env) as { type: string }).type, "text");
  assert.deepEqual(payload("evolution", "5520900000031", "texto", "12345678", env), { number: "5520900000031", text: "texto" });
});

test("readiness: WhatsApp habilitado exige segredo de recuperação e template Meta", () => {
  const env = { DATABASE_URL: "postgresql://u:p@localhost:5432/app_test", APP_URL: "http://localhost:3000", CRON_SECRET: "x".repeat(20), WHATSAPP_ENABLED: "true", WHATSAPP_PROVIDER: "meta", WHATSAPP_API_URL: "https://graph.facebook.com/v1/1/messages", WHATSAPP_API_TOKEN: "t" };
  const issues = checkCriticalConfiguration(env).issues;
  assert.ok(issues.includes("password_recovery_secret"));
  assert.ok(issues.includes("whatsapp_auth_template"));
  const fixed = checkCriticalConfiguration({ ...env, PASSWORD_RESET_SECRET: SECRET, WHATSAPP_AUTH_TEMPLATE_NAME: "alfa_codigo" }).issues;
  assert.ok(!fixed.includes("password_recovery_secret") && !fixed.includes("whatsapp_auth_template"));
  assert.ok(!checkCriticalConfiguration({ ...env, WHATSAPP_ENABLED: "false" }).issues.includes("password_recovery_secret"));
});
